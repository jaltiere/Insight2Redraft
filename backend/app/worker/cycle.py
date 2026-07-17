import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import League, Season, SeasonStatus, Team, WeeklyScore
from app.sleeper.client import SleeperClient
from app.sleeper.models import NflState
from app.sync.ruleset import resolve_ruleset
from app.sync.service import SyncService

logger = logging.getLogger(__name__)

_IDLE_STATUSES = {SeasonStatus.SETUP, SeasonStatus.COMPLETE}


@dataclass
class PlayersSyncState:
    last_synced_at: datetime | None = None


@dataclass(frozen=True)
class CycleResult:
    nfl_state: NflState
    season_active: bool
    week: int | None
    leagues_synced: int
    leagues_failed: int
    players_synced: bool


async def run_cycle(
    client: SleeperClient,
    session_factory: sessionmaker,
    clock: Callable[[], datetime],
    players_state: PlayersSyncState,
) -> CycleResult:
    nfl_state = await client.get_nfl_state()
    year = int(nfl_state.season)
    week = nfl_state.week

    with session_factory() as session:
        season = session.query(Season).filter_by(year=year).one_or_none()
        if season is None or season.status in _IDLE_STATUSES:
            logger.info("cycle idle: no active season for %s", year)
            return CycleResult(nfl_state, False, None, 0, 0, False)
        season_id = season.id
        league_ids = [
            row.id for row in session.query(League).filter_by(season_id=season.id).all()
        ]
        ruleset = resolve_ruleset(session, season)

    synced = 0
    failed = 0
    for league_id in league_ids:
        try:
            with session_factory.begin() as session:
                season = session.get(Season, season_id)
                service = SyncService(client, session, season, ruleset)
                await service.sync_week(league_id, week)
                mismatches = (
                    session.query(WeeklyScore)
                    .join(Team, WeeklyScore.team_id == Team.id)
                    .filter(
                        Team.league_id == league_id,
                        WeeklyScore.week == week,
                        WeeklyScore.mismatch_flag.is_(True),
                    )
                    .count()
                )
                logger.info(
                    "league %s week %s synced: mismatches=%s", league_id, week, mismatches
                )
            synced += 1
        except Exception:
            logger.exception("league %s week %s sync failed", league_id, week)
            failed += 1

    players_synced = await _maybe_sync_players(
        client, session_factory, clock, players_state, season_id, ruleset
    )
    return CycleResult(nfl_state, True, week, synced, failed, players_synced)


def _players_due(players_state: PlayersSyncState, now: datetime) -> bool:
    if players_state.last_synced_at is None:
        return True
    return now - players_state.last_synced_at >= timedelta(
        hours=settings.worker_players_sync_hours
    )


async def _maybe_sync_players(
    client: SleeperClient,
    session_factory: sessionmaker,
    clock: Callable[[], datetime],
    players_state: PlayersSyncState,
    season_id: int,
    ruleset: dict,
) -> bool:
    now = clock()
    if not _players_due(players_state, now):
        return False
    try:
        with session_factory.begin() as session:
            season = session.get(Season, season_id)
            service = SyncService(client, session, season, ruleset)
            await service.sync_players()
        players_state.last_synced_at = now
        return True
    except Exception:
        logger.exception("players sync failed")
        return False
