from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import League, Season, Team
from app.sleeper.client import SleeperClient
from app.sleeper.models import SleeperRoster
from app.sync.validation import validate_scoring


@dataclass(frozen=True)
class LeagueSyncResult:
    league_id: int
    scoring_validated: bool
    diffs: list[tuple[str, float, float]]
    commish_sleeper_id: str | None


class SyncService:
    """Orchestrates Sleeper client + scoring engine into idempotent DB writes.

    Methods flush but never commit/rollback — the caller owns the transaction.
    """

    def __init__(
        self,
        client: SleeperClient,
        session: Session,
        season: Season,
        ruleset: Mapping[str, float],
    ) -> None:
        self._client = client
        self._session = session
        self._season = season
        self._ruleset = ruleset

    async def sync_league_setup(self, sleeper_league_id: str) -> LeagueSyncResult:
        league_data = await self._client.get_league(sleeper_league_id)
        users = await self._client.get_league_users(sleeper_league_id)
        rosters = await self._client.get_league_rosters(sleeper_league_id)

        league = (
            self._session.query(League)
            .filter_by(season_id=self._season.id, sleeper_league_id=sleeper_league_id)
            .one_or_none()
        )
        if league is None:
            league = League(season_id=self._season.id, sleeper_league_id=sleeper_league_id)
            self._session.add(league)

        league.name = league_data.name
        commish_id = next((u.user_id for u in users if u.is_commissioner), None)
        league.commish_sleeper_id = commish_id

        validation = validate_scoring(league_data.scoring_settings, self._ruleset)
        league.scoring_validated = validation.validated

        self._session.flush()
        self._upsert_teams(league, rosters)
        self._session.flush()

        return LeagueSyncResult(
            league_id=league.id,
            scoring_validated=validation.validated,
            diffs=validation.diffs,
            commish_sleeper_id=commish_id,
        )

    def _upsert_teams(self, league: League, rosters: list[SleeperRoster]) -> list[Team]:
        existing = {
            t.sleeper_roster_id: t
            for t in self._session.query(Team).filter_by(league_id=league.id).all()
        }
        teams: list[Team] = []
        for roster in rosters:
            team = existing.get(roster.roster_id)
            if team is None:
                team = Team(league_id=league.id, sleeper_roster_id=roster.roster_id)
                self._session.add(team)
            # Sleeper-derived fields refresh on every sync; owner_id is preserved.
            team.sleeper_user_id = roster.owner_id
            team.wins = roster.settings.wins
            team.losses = roster.settings.losses
            team.ties = roster.settings.ties
            team.points_for = Decimal(str(roster.points_for))
            team.points_against = Decimal(str(roster.points_against))
            teams.append(team)
        return teams
