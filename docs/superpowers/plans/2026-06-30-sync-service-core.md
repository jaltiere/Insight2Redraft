# Sync Service Core (Plan 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `app/sync` — the orchestration layer that turns Sleeper data into persisted platform state via idempotent single-league and single-week operations, with independent hybrid recompute, mismatch flagging, league scoring-validation, and player/stat caching.

**Architecture:** A pure `validate_scoring` function plus a `SyncService` constructed with an injected async `SleeperClient`, a SQLAlchemy `Session`, the active `Season`, and the platform ruleset dict. Methods pull from Sleeper (`await`), upsert by natural key, and **flush but never commit** — the caller owns the transaction boundary (tests roll back via the `db_session` fixture; the future 3b worker wraps calls in `session.begin()`). No scheduling, no cross-league loop, no game-window logic (those are Plan 3b).

**Tech Stack:** Python 3.14, SQLAlchemy 2.x (sync Session), Pydantic v2 (Sleeper models), httpx `MockTransport` for tests, pytest with `asyncio_mode = "auto"`, Dockerized Postgres (`Insight2Redraft` container) for the test DB.

## Global Constraints

- Python module style matches existing `app/sleeper` and `app/scoring`: typed signatures, `from __future__` not used, `Decimal` for money/points.
- All points/score arithmetic uses `Decimal`, rounded to 2 places half-up — reuse `app.scoring.engine` (`score_players`, `sum_points`), never re-implement scoring.
- Enum/DB representation already settled; this plan adds no enum columns.
- Natural keys (already enforced by `UniqueConstraint` in the models): `league(season_id, sleeper_league_id)`, `team(league_id, sleeper_roster_id)`, `weekly_score(team_id, week)`, `player(sleeper_player_id)`, `player_stat_cache(sleeper_player_id, season, week)`.
- `SyncService` methods MUST call `session.flush()` and MUST NOT call `session.commit()` or `session.rollback()`.
- Re-syncing MUST preserve an existing `team.owner_id` (never write or clear it).
- `mismatch_flag = abs(sleeper_points - recomputed_points) > Decimal("0.01")`.
- Recompute always uses the injected **platform** ruleset, never the league's Sleeper `scoring_settings`.
- Tests make no live Sleeper calls — always `httpx.MockTransport` with fixture payloads.

---

### Task 1: Package scaffold + scoring validation

**Files:**
- Create: `backend/app/sync/__init__.py`
- Create: `backend/app/sync/validation.py`
- Create: `backend/tests/sync/__init__.py`
- Test: `backend/tests/sync/test_validation.py`

**Interfaces:**
- Consumes: nothing (pure function over dicts).
- Produces:
  - `ValidationResult` — `@dataclass(frozen=True)` with `validated: bool` and `diffs: list[tuple[str, float, float]]` (each tuple is `(category, league_value, platform_value)`).
  - `validate_scoring(league_scoring: Mapping[str, float], platform_ruleset: Mapping[str, float]) -> ValidationResult`.

- [ ] **Step 1: Create the empty package markers**

Create `backend/app/sync/__init__.py` with a single line:

```python
"""Sync service: orchestrates Sleeper client + scoring engine into DB writes."""
```

Create `backend/tests/sync/__init__.py` as an empty file (no content).

- [ ] **Step 2: Write the failing validation tests**

Create `backend/tests/sync/test_validation.py`:

```python
from app.sync.validation import ValidationResult, validate_scoring


def test_exact_match_is_validated():
    ruleset = {"rec": 1.0, "pass_td": 4.0}
    result = validate_scoring({"rec": 1.0, "pass_td": 4.0}, ruleset)
    assert isinstance(result, ValidationResult)
    assert result.validated is True
    assert result.diffs == []


def test_single_category_diff_is_not_validated():
    result = validate_scoring({"rec": 0.5, "pass_td": 4.0}, {"rec": 1.0, "pass_td": 4.0})
    assert result.validated is False
    assert result.diffs == [("rec", 0.5, 1.0)]


def test_absent_category_normalizes_to_zero():
    # league omits pass_td entirely; platform scores it -> diff against 0.0
    result = validate_scoring({"rec": 1.0}, {"rec": 1.0, "pass_td": 4.0})
    assert result.validated is False
    assert result.diffs == [("pass_td", 0.0, 4.0)]


def test_absent_on_both_effective_sides_is_validated():
    # platform has rec only; league has rec plus a category that is 0.0 -> no effect
    result = validate_scoring({"rec": 1.0, "bonus": 0.0}, {"rec": 1.0})
    assert result.validated is True
    assert result.diffs == []


def test_extra_nonzero_league_category_is_not_validated():
    result = validate_scoring({"rec": 1.0, "bonus": 2.0}, {"rec": 1.0})
    assert result.validated is False
    assert result.diffs == [("bonus", 2.0, 0.0)]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/sync/test_validation.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sync.validation'`.

- [ ] **Step 4: Implement `validation.py`**

Create `backend/app/sync/validation.py`:

```python
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationResult:
    validated: bool
    diffs: list[tuple[str, float, float]]


def validate_scoring(
    league_scoring: Mapping[str, float],
    platform_ruleset: Mapping[str, float],
) -> ValidationResult:
    """Compare a league's Sleeper scoring settings to the platform ruleset.

    A category absent from either side is treated as 0.0. ``validated`` is True
    only when every category matches exactly. ``diffs`` lists every mismatching
    category as ``(category, league_value, platform_value)``, sorted by name.
    """
    diffs: list[tuple[str, float, float]] = []
    for key in sorted(set(league_scoring) | set(platform_ruleset)):
        league_value = league_scoring.get(key, 0.0)
        platform_value = platform_ruleset.get(key, 0.0)
        if league_value != platform_value:
            diffs.append((key, league_value, platform_value))
    return ValidationResult(validated=not diffs, diffs=diffs)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/sync/test_validation.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/sync/__init__.py backend/app/sync/validation.py \
        backend/tests/sync/__init__.py backend/tests/sync/test_validation.py
git commit -m "feat: add sync package + validate_scoring"
```

---

### Task 2: `SyncService.sync_league_setup`

**Files:**
- Create: `backend/app/sync/errors.py`
- Create: `backend/app/sync/service.py`
- Create: `backend/tests/sync/conftest.py`
- Test: `backend/tests/sync/test_service.py`

**Interfaces:**
- Consumes:
  - `validate_scoring`, `ValidationResult` from `app.sync.validation` (Task 1).
  - `SleeperClient` (async) with `get_league(league_id) -> SleeperLeague`, `get_league_users(league_id) -> list[SleeperUser]`, `get_league_rosters(league_id) -> list[SleeperRoster]` from `app.sleeper.client`.
  - Models `League`, `Team` from `app.models`; `Season` from `app.models`.
  - `SleeperUser.is_commissioner: bool`, `SleeperRoster.roster_id: int`, `SleeperRoster.owner_id: str | None`, `SleeperRoster.settings` (`wins/losses/ties: int`), `SleeperRoster.points_for: float`, `SleeperRoster.points_against: float`.
- Produces:
  - `SyncError(Exception)` in `app.sync.errors`.
  - `LeagueSyncResult` — `@dataclass(frozen=True)` with `league_id: int`, `scoring_validated: bool`, `diffs: list[tuple[str, float, float]]`, `commish_sleeper_id: str | None`.
  - `SyncService(client: SleeperClient, session: Session, season: Season, ruleset: Mapping[str, float])`.
  - `async SyncService.sync_league_setup(sleeper_league_id: str) -> LeagueSyncResult`.
  - Private helper `SyncService._upsert_teams(league: League, rosters: list[SleeperRoster]) -> list[Team]` (reused by Task 3).

- [ ] **Step 1: Create the test conftest (shared client + fixtures helper)**

Create `backend/tests/sync/conftest.py`:

```python
import json
from pathlib import Path

import httpx
import pytest

from app.sleeper.client import SleeperClient

# Reuse the recorded Sleeper fixtures from the sleeper test package (DRY).
_SLEEPER_FIXTURES = Path(__file__).parents[1] / "sleeper" / "fixtures"
_SYNC_FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str):
    for base in (_SYNC_FIXTURES, _SLEEPER_FIXTURES):
        path = base / name
        if path.exists():
            return json.loads(path.read_text())
    raise FileNotFoundError(name)


async def _noop_sleep(_seconds: float) -> None:
    return None


def route_client(routes: dict[str, object]) -> SleeperClient:
    """SleeperClient whose MockTransport returns a payload by URL-path suffix."""

    def handler(request: httpx.Request) -> httpx.Response:
        for suffix, payload in routes.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


@pytest.fixture()
def league_routes():
    """Routes covering league config, users, and rosters for league 987654321."""
    return {
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321": load_fixture("league.json"),
    }
```

Note: order matters — the more specific `/users` and `/rosters` suffixes are listed before the bare `/league/987654321`, and `route_client` checks them in dict order.

- [ ] **Step 2: Write the failing `sync_league_setup` tests**

Create `backend/tests/sync/test_service.py`:

```python
import pytest

from app.models import League, Season, Team
from app.sync.errors import SyncError
from app.sync.service import LeagueSyncResult, SyncService
from tests.sync.conftest import route_client

# Matches league.json scoring_settings exactly -> validated True.
MATCHING_RULESET = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}


def _season(db_session) -> Season:
    season = Season(year=2024)
    db_session.add(season)
    db_session.flush()
    return season


async def test_sync_league_setup_upserts_league_and_teams(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    result = await service.sync_league_setup("987654321")

    assert isinstance(result, LeagueSyncResult)
    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    assert league.name == "Alpha League"
    assert league.season_id == season.id
    assert result.commish_sleeper_id == "100"

    teams = db_session.query(Team).filter_by(league_id=league.id).all()
    assert {t.sleeper_roster_id for t in teams} == {1, 2}
    roster1 = next(t for t in teams if t.sleeper_roster_id == 1)
    assert roster1.sleeper_user_id == "100"
    assert roster1.wins == 9 and roster1.losses == 4
    assert str(roster1.points_for) == "1521.40"


async def test_sync_league_setup_sets_validated_true_on_match(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    result = await service.sync_league_setup("987654321")

    assert result.scoring_validated is True
    assert result.diffs == []
    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    assert league.scoring_validated is True


async def test_sync_league_setup_flags_validation_diffs(db_session, league_routes):
    season = _season(db_session)
    # platform expects pass_td 6.0 but league has 4.0 -> a diff, not validated
    ruleset = {**MATCHING_RULESET, "pass_td": 6.0}
    service = SyncService(route_client(league_routes), db_session, season, ruleset)

    result = await service.sync_league_setup("987654321")

    assert result.scoring_validated is False
    assert ("pass_td", 4.0, 6.0) in result.diffs


async def test_sync_league_setup_is_idempotent(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    await service.sync_league_setup("987654321")
    await service.sync_league_setup("987654321")

    assert db_session.query(League).count() == 1
    assert db_session.query(Team).count() == 2


async def test_sync_league_setup_preserves_owner_id(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)
    await service.sync_league_setup("987654321")

    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    team = db_session.query(Team).filter_by(league_id=league.id, sleeper_roster_id=1).one()
    team.owner_id = None  # ensure column exists; then simulate an admin mapping below
    from app.models import Owner

    owner = Owner(first_name="Jane", last_name="Doe")
    db_session.add(owner)
    db_session.flush()
    team.owner_id = owner.id
    db_session.flush()

    await service.sync_league_setup("987654321")  # re-sync must not clobber owner_id

    refreshed = db_session.query(Team).filter_by(league_id=league.id, sleeper_roster_id=1).one()
    assert refreshed.owner_id == owner.id
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/sync/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sync.service'`.

- [ ] **Step 4: Implement `errors.py`**

Create `backend/app/sync/errors.py`:

```python
class SyncError(Exception):
    """A sync-level failure (e.g. operating on a league row that does not exist)."""
```

- [ ] **Step 5: Implement `service.py` (league setup only)**

Create `backend/app/sync/service.py`:

```python
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/sync/test_service.py -v`
Expected: PASS (5 tests). Requires the `Insight2Redraft` Postgres container running (`docker start Insight2Redraft`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/sync/errors.py backend/app/sync/service.py \
        backend/tests/sync/conftest.py backend/tests/sync/test_service.py
git commit -m "feat: add SyncService.sync_league_setup with team upsert + validation"
```

---

### Task 3: `SyncService.sync_week`

**Files:**
- Modify: `backend/app/sync/service.py`
- Create: `backend/tests/sync/fixtures/matchups_empty.json`
- Modify: `backend/tests/sync/test_service.py`

**Interfaces:**
- Consumes:
  - `SyncService._upsert_teams` (Task 2), `SyncError` (Task 2).
  - `SleeperClient.get_matchups(league_id, week) -> list[SleeperMatchup]`, `get_league_rosters(...)`, `get_weekly_stats(season: str, week: int) -> dict[str, dict[str, float]]`.
  - `SleeperMatchup.roster_id: int`, `.points: float`, `.players: list[str]`, `.starters: list[str]`, `.players_points: dict[str, float]`.
  - `app.scoring.engine.score_players(player_stats, ruleset) -> dict[str, Decimal]`, `sum_points(player_ids, player_points) -> Decimal`.
  - Models `WeeklyScore`, `PlayerStatCache` from `app.models`.
- Produces:
  - `WeekSyncResult` — `@dataclass(frozen=True)` with `scored_team_ids: list[int]` and `skipped_roster_ids: list[int]`.
  - `async SyncService.sync_week(league_id: int, week: int) -> WeekSyncResult`.

- [ ] **Step 1: Create the empty-matchups fixture**

Create `backend/tests/sync/fixtures/matchups_empty.json`:

```json
[]
```

- [ ] **Step 2: Write the failing `sync_week` tests**

Add to `backend/tests/sync/test_service.py` (append; keep existing imports, add the new names):

```python
from decimal import Decimal

from app.models import PlayerStatCache, WeeklyScore
from app.sync.service import WeekSyncResult


def _week_routes(league_routes):
    from tests.sync.conftest import load_fixture

    return {
        **league_routes,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
    }


async def _synced_league(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(_week_routes(league_routes)), db_session, season, MATCHING_RULESET)
    result = await service.sync_league_setup("987654321")
    return service, result.league_id


async def test_sync_week_records_recompute_and_mismatch(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    result = await service.sync_week(league_id, 5)

    assert isinstance(result, WeekSyncResult)
    assert result.skipped_roster_ids == []

    team = db_session.query(Team).filter_by(league_id=league_id, sleeper_roster_id=1).one()
    score = db_session.query(WeeklyScore).filter_by(team_id=team.id, week=5).one()
    assert score.sleeper_points == Decimal("120.50")
    assert score.recomputed_points == Decimal("23.40")
    assert score.bench_points == Decimal("20.80")
    assert score.mismatch_flag is True


async def test_sync_week_caches_player_stats(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    await service.sync_week(league_id, 5)

    cached = db_session.query(PlayerStatCache).filter_by(
        sleeper_player_id="4046", season=2024, week=5
    ).one()
    assert cached.stats["pass_yd"] == 305


async def test_sync_week_is_idempotent(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    await service.sync_week(league_id, 5)
    await service.sync_week(league_id, 5)

    assert db_session.query(WeeklyScore).count() == 2  # one per team, not four


async def test_sync_week_skips_rosters_without_lineup(db_session, league_routes):
    season = _season(db_session)
    routes = {
        **league_routes,
        "/league/987654321/matchups/18": load_fixture_empty(),
        "/stats/nfl/regular/2024/18": {},
    }
    service = SyncService(route_client(routes), db_session, season, MATCHING_RULESET)
    league_id = (await service.sync_league_setup("987654321")).league_id

    result = await service.sync_week(league_id, 18)

    assert result.scored_team_ids == []
    assert db_session.query(WeeklyScore).count() == 0


async def test_sync_week_unknown_league_raises(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)
    with pytest.raises(SyncError):
        await service.sync_week(999999, 5)
```

Add this helper near the top of the test module (after the imports):

```python
def load_fixture_empty():
    from tests.sync.conftest import load_fixture

    return load_fixture("matchups_empty.json")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/sync/test_service.py -k sync_week -v`
Expected: FAIL — `AttributeError: 'SyncService' object has no attribute 'sync_week'` (or `ImportError` for `WeekSyncResult`).

- [ ] **Step 4: Implement `sync_week`**

In `backend/app/sync/service.py`, update the imports and add the result dataclass + method. Add to the imports block:

```python
from app.models import League, PlayerStatCache, Season, Team, WeeklyScore
from app.scoring.engine import score_players, sum_points
from app.sleeper.models import SleeperMatchup, SleeperRoster
from app.sync.errors import SyncError
```

Add the dataclass after `LeagueSyncResult`:

```python
@dataclass(frozen=True)
class WeekSyncResult:
    scored_team_ids: list[int]
    skipped_roster_ids: list[int]
```

Add the method to `SyncService`:

```python
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
        bench = [p for p in matchup.players if p not in set(starters)]
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/sync/test_service.py -v`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/sync/service.py backend/tests/sync/test_service.py \
        backend/tests/sync/fixtures/matchups_empty.json
git commit -m "feat: add SyncService.sync_week with hybrid recompute + skip-no-row"
```

---

### Task 4: `SyncService.sync_players`

**Files:**
- Modify: `backend/app/sync/service.py`
- Create: `backend/tests/sync/fixtures/players.json`
- Modify: `backend/tests/sync/test_service.py`

**Interfaces:**
- Consumes: `SleeperClient.get_players() -> dict[str, SleeperPlayer]`; `SleeperPlayer.player_id/full_name/position/team`; model `Player` from `app.models`.
- Produces: `async SyncService.sync_players() -> int` (count upserted).

- [ ] **Step 1: Create the players fixture**

Create `backend/tests/sync/fixtures/players.json`:

```json
{
  "4046": {"full_name": "Patrick Mahomes", "position": "QB", "team": "KC"},
  "6794": {"full_name": "Amon-Ra St. Brown", "position": "WR", "team": "DET"}
}
```

- [ ] **Step 2: Write the failing tests**

Add to `backend/tests/sync/test_service.py`:

```python
from app.models import Player


async def test_sync_players_upserts(db_session, league_routes):
    season = _season(db_session)
    routes = {"/players/nfl": load_players_fixture()}
    service = SyncService(route_client(routes), db_session, season, MATCHING_RULESET)

    count = await service.sync_players()

    assert count == 2
    player = db_session.query(Player).filter_by(sleeper_player_id="4046").one()
    assert player.full_name == "Patrick Mahomes"
    assert player.position == "QB"
    assert player.nfl_team == "KC"


async def test_sync_players_is_idempotent(db_session, league_routes):
    season = _season(db_session)
    routes = {"/players/nfl": load_players_fixture()}
    service = SyncService(route_client(routes), db_session, season, MATCHING_RULESET)

    await service.sync_players()
    await service.sync_players()

    assert db_session.query(Player).count() == 2
```

Add the helper near the other test helpers:

```python
def load_players_fixture():
    from tests.sync.conftest import load_fixture

    return load_fixture("players.json")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/sync/test_service.py -k sync_players -v`
Expected: FAIL — `AttributeError: 'SyncService' object has no attribute 'sync_players'`.

- [ ] **Step 4: Implement `sync_players`**

In `backend/app/sync/service.py`, add `Player` to the models import and add the method:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/sync/test_service.py -k sync_players -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/sync/service.py backend/tests/sync/test_service.py \
        backend/tests/sync/fixtures/players.json
git commit -m "feat: add SyncService.sync_players upsert"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Ensure Postgres is running**

Run: `docker start Insight2Redraft`
Expected: prints `Insight2Redraft`.

- [ ] **Step 2: Run the full backend suite**

Run: `cd backend && uv run pytest -q`
Expected: PASS — all prior tests (51) plus the new sync tests (5 validation + 12 service = 17), clean except the single pre-existing Starlette/httpx deprecation warning from the health test.

- [ ] **Step 3: Confirm no live network and no stray commits**

Run: `git status` and `git log --oneline -5`
Expected: clean working tree; four new sync commits on the branch.

---

## Self-Review

- **Spec coverage:**
  - Module/boundaries (`app/sync/` with `service.py`/`validation.py`/`errors.py`, injected deps, no scheduling) → Tasks 1–2.
  - `sync_league_setup` (upsert league+team, validation, commish, owner_id preservation, idempotency) → Task 2.
  - `sync_week` (matchups+stats pull, weekly_score upsert with sleeper/recomputed/bench/mismatch, stat cache, standings refresh, skip-no-row, SyncError on missing league) → Task 3.
  - Independent recompute on platform ruleset, `Decimal`, epsilon 0.01 → Task 3 (`_upsert_weekly_score`).
  - "Usable data" predicate (non-empty starters AND non-empty players_points), skipped-roster report → Task 3.
  - Scoring validation pure function, absent→0, validated-only-on-clean-match, diffs always → Task 1.
  - `sync_players` upsert (function here, scheduling deferred) → Task 4.
  - Errors (`SyncError`; `SleeperError` propagates) → Tasks 2–3.
  - Testing against `MockTransport` + fixtures on the test Postgres, no live calls → all tasks; full-suite gate → Task 5.
- **Refinement vs spec (intentional):** spec wording said "non-null points"; because `SleeperMatchup.points` is non-nullable (defaults 0.0), the predicate keys on `players_points` being non-empty — the faithful observable signal of a scored week. The empty-matchup fixture (Task 3) stands in for the league-ended case; confirming Sleeper's exact unscored-week payload remains a deferred verification noted in the spec.
- **Transaction model:** methods `flush()` only; the caller owns commit/rollback. Tests rely on the `db_session` fixture's transaction + rollback; the 3b worker will wrap each call in `session.begin()`. This satisfies the spec's atomicity intent without a service-owned commit.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `_upsert_teams` (Task 2) reused by `sync_week` (Task 3); `score_players`/`sum_points` signatures match `app/scoring/engine.py`; result dataclasses (`LeagueSyncResult`, `WeekSyncResult`, `ValidationResult`) referenced consistently; natural-key filters match the models' `UniqueConstraint`s.
- **Deferred (Plan 3b, correctly absent):** scheduling, game windows, cross-league orchestration loop, `players/nfl` dump cadence, flagged-team resolution policy.
