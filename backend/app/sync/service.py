from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import League, Player, PlayerStatCache, Season, Team, WeeklyScore
from app.scoring.engine import score_players, sum_points
from app.sleeper.client import SleeperClient
from app.sleeper.models import SleeperMatchup, SleeperRoster
from app.sync.errors import SyncError
from app.sync.validation import validate_scoring


@dataclass(frozen=True)
class LeagueSyncResult:
    league_id: int
    scoring_validated: bool
    diffs: list[tuple[str, float, float]]
    commish_sleeper_id: str | None


@dataclass(frozen=True)
class WeekSyncResult:
    scored_team_ids: list[int]
    skipped_roster_ids: list[int]


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

    async def sync_week(self, league_id: int, week: int) -> WeekSyncResult:
        league = self._session.get(League, league_id)
        if league is None:
            raise SyncError(f"league {league_id} not found")

        matchups = await self._client.get_matchups(league.sleeper_league_id, week)
        rosters = await self._client.get_league_rosters(league.sleeper_league_id)
        week_stats = await self._client.get_weekly_stats(str(self._season.year), week)

        # Refresh standings from current rosters (live W/L, points-for).
        self._upsert_teams(league, rosters)
        self._session.flush()

        team_by_roster = {
            t.sleeper_roster_id: t
            for t in self._session.query(Team).filter_by(league_id=league.id).all()
        }
        all_points = score_players(week_stats, self._ruleset)

        # Cache the raw stat lines for every player that appeared in a matchup.
        involved: set[str] = set()
        for matchup in matchups:
            involved.update(matchup.players)
        self._cache_player_stats(involved, week, week_stats)

        scored: list[int] = []
        skipped: list[int] = []
        for matchup in matchups:
            if not matchup.starters or not matchup.players_points:
                skipped.append(matchup.roster_id)
                continue
            team = team_by_roster.get(matchup.roster_id)
            if team is None:
                skipped.append(matchup.roster_id)
                continue
            self._upsert_weekly_score(team, week, matchup, all_points)
            scored.append(team.id)

        self._session.flush()
        return WeekSyncResult(scored_team_ids=scored, skipped_roster_ids=skipped)

    async def sync_players(self) -> int:
        players = await self._client.get_players()
        existing = {p.sleeper_player_id: p for p in self._session.query(Player).all()}
        for pid, data in players.items():
            row = existing.get(pid)
            if row is None:
                row = Player(sleeper_player_id=pid)
                self._session.add(row)
            row.full_name = data.full_name
            row.position = data.position
            row.nfl_team = data.team
        self._session.flush()
        return len(players)

    def _cache_player_stats(
        self, player_ids: set[str], week: int, week_stats: Mapping[str, Mapping[str, float]]
    ) -> None:
        existing = {
            row.sleeper_player_id: row
            for row in self._session.query(PlayerStatCache)
            .filter_by(season=self._season.year, week=week)
            .all()
        }
        for pid in player_ids:
            row = existing.get(pid)
            if row is None:
                row = PlayerStatCache(
                    sleeper_player_id=pid, season=self._season.year, week=week
                )
                self._session.add(row)
            row.stats = dict(week_stats.get(pid, {}))

    def _upsert_weekly_score(
        self,
        team: Team,
        week: int,
        matchup: SleeperMatchup,
        all_points: Mapping[str, Decimal],
    ) -> None:
        starters = matchup.starters
        starter_set = set(starters)
        bench = [p for p in matchup.players if p not in starter_set]
        recomputed = sum_points(starters, all_points)
        bench_points = sum_points(bench, all_points)
        sleeper_points = Decimal(str(matchup.points))

        score = (
            self._session.query(WeeklyScore)
            .filter_by(team_id=team.id, week=week)
            .one_or_none()
        )
        if score is None:
            score = WeeklyScore(team_id=team.id, week=week)
            self._session.add(score)
        score.sleeper_points = sleeper_points
        score.recomputed_points = recomputed
        score.bench_points = bench_points
        score.mismatch_flag = abs(sleeper_points - recomputed) > Decimal("0.01")

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
