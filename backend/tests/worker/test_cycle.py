from datetime import timedelta
from decimal import Decimal

import pytest

from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    League,
    Season,
    SeasonStatus,
    Team,
    WeeklyScore,
)
from app.worker.cycle import CycleResult, PlayersSyncState, run_cycle
from tests.worker.conftest import UTC_NOW, fixed_clock, load_fixture, route_client

_STATE = {"season": "2024", "week": 5, "season_type": "regular", "leg": 5}


def _base_routes():
    return {
        "/state/nfl": _STATE,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321": load_fixture("league.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
        "/players/nfl": load_fixture("players.json"),
    }


def _seed_season(session_factory, *, status=SeasonStatus.REGULAR, leagues=("987654321",)):
    with session_factory.begin() as session:
        season = Season(year=2024, status=status)
        session.add(season)
        session.flush()
        for lid in leagues:
            session.add(League(season_id=season.id, sleeper_league_id=lid, name="seed"))


async def test_run_cycle_syncs_active_season_leagues(session_factory):
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState()

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert isinstance(result, CycleResult)
    assert result.season_active is True
    assert result.week == 5
    assert result.leagues_synced == 1
    assert result.leagues_failed == 0
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 2  # one per team in the league


async def test_run_cycle_idle_when_no_active_season(session_factory):
    _seed_season(session_factory, status=SeasonStatus.SETUP)
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.season_active is False
    assert result.leagues_synced == 0
    assert result.players_synced is False
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 0


async def test_run_cycle_idle_when_no_season_in_db(session_factory):
    # No season seeded at all -> the year lookup returns None -> idle.
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.season_active is False
    assert result.leagues_synced == 0
    assert result.players_synced is False


async def test_run_cycle_idle_when_season_complete(session_factory):
    _seed_season(session_factory, status=SeasonStatus.COMPLETE)
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.season_active is False
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 0


async def test_run_cycle_isolates_failing_league(session_factory):
    # league 987654321 has full routes; league 555 has none -> its matchups 404 -> fails
    _seed_season(session_factory, leagues=("987654321", "555"))
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.leagues_synced == 1
    assert result.leagues_failed == 1
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 2  # only the good league wrote rows


async def test_run_cycle_syncs_players_when_due(session_factory):
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState()  # never synced -> due

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert result.players_synced is True
    assert state.last_synced_at == UTC_NOW
    from app.models import Player

    with session_factory() as session:
        assert session.query(Player).count() == 2


async def test_run_cycle_skips_players_when_recent(session_factory, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "worker_players_sync_hours", 24.0)
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState(last_synced_at=UTC_NOW - timedelta(hours=1))

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert result.players_synced is False
    from app.models import Player

    with session_factory() as session:
        assert session.query(Player).count() == 0


async def test_run_cycle_updates_bracket_live_scores(session_factory):
    with session_factory.begin() as session:
        season = Season(year=2024, status=SeasonStatus.PLAYOFFS)
        session.add(season)
        session.flush()
        league = League(season_id=season.id, sleeper_league_id="987654321", name="seed")
        session.add(league)
        session.flush()
        t1 = Team(league_id=league.id, sleeper_roster_id=1)
        t2 = Team(league_id=league.id, sleeper_roster_id=2)
        session.add_all([t1, t2])
        session.flush()
        bracket = Bracket(season_id=season.id, size=2, status=BracketStatus.ACTIVE)
        session.add(bracket)
        session.flush()
        session.add_all([
            BracketSeed(bracket_id=bracket.id, team_id=t1.id, seed=1),
            BracketSeed(bracket_id=bracket.id, team_id=t2.id, seed=2),
        ])
        session.add(
            BracketMatchup(
                bracket_id=bracket.id, round=1, nfl_week=5,
                team_a_id=t1.id, team_b_id=t2.id, bye=False, is_finalized=False,
            )
        )

    client = route_client(_base_routes())
    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())
    assert result.season_active is True

    with session_factory() as session:
        game = session.query(BracketMatchup).filter_by(round=1).one()
        assert game.team_a_score is not None  # live score copied from recomputed_points
        assert game.team_b_score is not None
        assert game.winner_team_id is None and not game.is_finalized  # worker never finalizes
