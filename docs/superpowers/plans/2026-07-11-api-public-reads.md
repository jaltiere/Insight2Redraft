# Public Read Endpoints (API-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public, unauthenticated read endpoints — seasons/standings, leagues/teams, and a basic owner profile — for the Insight2Redraft API, backed by already-synced Postgres data.

**Architecture:** Thin per-resource `APIRouter`s (`seasons`, `leagues`+`teams`, `owners`) under the existing `app/api/` package, doing read-only `SELECT`s via the existing `app.db.get_db`. Owner-profile aggregation lives in a separate `app/history/service.py` (query functions returning plain dataclasses), keeping SQL out of the routers and creating the seam for the deferred hall-of-fame slice. Public Pydantic response models live in `app/api/public_schemas.py`, separate from the auth schemas.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-api-public-reads-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- Postgres REQUIRED for tests — container `Insight2Redraft` on localhost:5432 (test DB `insight2redraft_test`).
- **No auth** on any API-2 endpoint. No use of API-1's `get_current_account`/role deps.
- **Read-only:** endpoints use `Depends(get_db)` for `SELECT` only; never commit.
- **Scoring internals are private:** no public response may contain `recomputed_points`, `bench_points`, or `mismatch_flag`. Public per-week points = `weekly_score.sleeper_points`; public aggregates = `team.points_for` / `team.points_against`.
- **Owner PII:** public owner data exposes only `first_name`, `last_name`, `display_name`, `avatar_url`. Never `email` or `notes`.
- **Money fields are typed `float` in response schemas** (clean JSON numbers; avoids Decimal-serialization ambiguity). Convert `Decimal` → `float` when constructing responses.
- **Standings order:** by win percentage `(wins + 0.5·ties) / games` descending, then `points_for` descending; a team with zero games sorts last.
- **Best weekly:** top N by `sleeper_points` descending, default N = 5.
- **Errors:** unknown path id → `404`; empty child collections → `200` with `[]`; malformed path param → FastAPI default `422`.
- **No new dependencies.** No pagination.
- Expected pre-existing warning baseline in test output: PyJWT `InsecureKeyLengthWarning` + one `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/api/public_schemas.py` (grown across Tasks 1, 2, 4), `app/api/seasons.py`, `app/api/leagues.py`, `app/api/owners.py`, `app/history/__init__.py`, `app/history/service.py`
- Modify: `app/main.py` (include three routers, one per router task)
- Test: `tests/conftest.py` (shared `seed` fixture), `tests/api/test_seasons.py`, `tests/api/test_leagues.py`, `tests/api/test_owners.py`, `tests/history/__init__.py`, `tests/history/test_service.py`

Reused as-is: `tests/api/conftest.py` (`app`, `client` fixtures with `get_db` overridden to `db_session`), `tests/conftest.py` (`engine`, `db_session`).

---

### Task 1: Shared seed fixture + season schemas + `/seasons` endpoints

**Files:**
- Create: `backend/app/api/public_schemas.py`
- Create: `backend/app/api/seasons.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/api/test_seasons.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.models.{Season, League, SeasonStatus}`; test fixtures `app`, `client` (from `tests/api/conftest.py`), `db_session` (from `tests/conftest.py`).
- Produces:
  - `app.api.public_schemas.SeasonSummary {id: int, year: int, status: SeasonStatus}`
  - `app.api.public_schemas.LeagueSummary {id: int, name: str, scoring_validated: bool}`
  - `app.api.public_schemas.SeasonDetail {id: int, year: int, status: SeasonStatus, playoff_field_per_league: int, nfl_playoff_weeks: list[int], leagues: list[LeagueSummary]}`
  - `app.api.seasons.router` — `APIRouter(tags=["public"])` with `GET /seasons`, `GET /seasons/{season_id}`, mounted in `create_app()`.
  - A `seed` pytest fixture (in `tests/conftest.py`) exposing `.owner(...)`, `.season(...)`, `.league(...)`, `.team(...)`, `.weekly(...)` factory methods, each adding+flushing and returning the ORM object. Used by Tasks 1–4.

- [ ] **Step 1: Add the shared `seed` fixture**

Append to `backend/tests/conftest.py`:

```python
from app.models import League, Owner, Season, SeasonStatus, Team, WeeklyScore


@pytest.fixture()
def seed(db_session):
    """Factory helpers for read-layer test data. Each call adds + flushes."""

    class _Seed:
        def __init__(self, session):
            self.s = session
            self._n = 0

        def _next(self) -> int:
            self._n += 1
            return self._n

        def owner(self, first_name="Jack", last_name="Altiere", **kw) -> Owner:
            o = Owner(first_name=first_name, last_name=last_name, **kw)
            self.s.add(o)
            self.s.flush()
            return o

        def season(self, year, status=SeasonStatus.REGULAR, **kw) -> Season:
            se = Season(year=year, status=status, **kw)
            self.s.add(se)
            self.s.flush()
            return se

        def league(self, season, name="League", scoring_validated=False, **kw) -> League:
            lg = League(
                season_id=season.id,
                sleeper_league_id=str(self._next()),
                name=name,
                scoring_validated=scoring_validated,
                **kw,
            )
            self.s.add(lg)
            self.s.flush()
            return lg

        def team(self, league, owner=None, wins=0, losses=0, ties=0,
                 points_for=0, points_against=0, league_finish=None, **kw) -> Team:
            t = Team(
                league_id=league.id,
                sleeper_roster_id=self._next(),
                owner_id=(owner.id if owner is not None else None),
                wins=wins, losses=losses, ties=ties,
                points_for=points_for, points_against=points_against,
                league_finish=league_finish, **kw,
            )
            self.s.add(t)
            self.s.flush()
            return t

        def weekly(self, team, week, sleeper_points, recomputed_points=None,
                   bench_points=None, mismatch_flag=False, is_final=False) -> WeeklyScore:
            ws = WeeklyScore(
                team_id=team.id, week=week, sleeper_points=sleeper_points,
                recomputed_points=recomputed_points, bench_points=bench_points,
                mismatch_flag=mismatch_flag, is_final=is_final,
            )
            self.s.add(ws)
            self.s.flush()
            return ws

    return _Seed(db_session)
```

(Note: `import pytest` is already at the top of the file — do not duplicate it.)

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/api/test_seasons.py`:

```python
from app.models import SeasonStatus


def test_list_seasons_newest_year_first(client, seed):
    seed.season(2024, status=SeasonStatus.COMPLETE)
    seed.season(2025, status=SeasonStatus.REGULAR)
    resp = client.get("/seasons")
    assert resp.status_code == 200
    years = [s["year"] for s in resp.json()]
    assert years == [2025, 2024]


def test_list_seasons_empty(client):
    resp = client.get("/seasons")
    assert resp.status_code == 200
    assert resp.json() == []


def test_season_detail_embeds_leagues(client, seed):
    season = seed.season(2025)
    seed.league(season, name="Alpha", scoring_validated=True)
    seed.league(season, name="Beta")
    resp = client.get(f"/seasons/{season.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["year"] == 2025
    assert body["status"] == "regular"
    names = sorted(lg["name"] for lg in body["leagues"])
    assert names == ["Alpha", "Beta"]
    assert {lg["name"]: lg["scoring_validated"] for lg in body["leagues"]}["Alpha"] is True


def test_season_detail_unknown_returns_404(client):
    resp = client.get("/seasons/999999")
    assert resp.status_code == 404
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_seasons.py -v`
Expected: FAIL — 404 on `/seasons` for all (router not mounted yet).

- [ ] **Step 4: Implement the season schemas**

Create `backend/app/api/public_schemas.py`:

```python
from pydantic import BaseModel, ConfigDict

from app.models import SeasonStatus


class SeasonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus


class LeagueSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    scoring_validated: bool


class SeasonDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus
    playoff_field_per_league: int
    nfl_playoff_weeks: list[int]
    leagues: list[LeagueSummary]
```

- [ ] **Step 5: Implement the seasons router**

Create `backend/app/api/seasons.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import LeagueSummary, SeasonDetail, SeasonSummary
from app.db import get_db
from app.models import League, Season

router = APIRouter(tags=["public"])


@router.get("/seasons", response_model=list[SeasonSummary])
def list_seasons(db: Session = Depends(get_db)) -> list[Season]:
    return list(
        db.execute(select(Season).order_by(Season.year.desc())).scalars().all()
    )


@router.get("/seasons/{season_id}", response_model=SeasonDetail)
def get_season(season_id: int, db: Session = Depends(get_db)) -> SeasonDetail:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    leagues = db.execute(
        select(League).where(League.season_id == season_id).order_by(League.name)
    ).scalars().all()
    return SeasonDetail(
        id=season.id,
        year=season.year,
        status=season.status,
        playoff_field_per_league=season.playoff_field_per_league,
        nfl_playoff_weeks=season.nfl_playoff_weeks,
        leagues=[LeagueSummary.model_validate(lg) for lg in leagues],
    )
```

- [ ] **Step 6: Wire the router into the app**

In `backend/app/main.py`, add the import next to the existing `auth_router` import and include it. The imports and `create_app()` become:

```python
import os

from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.seasons import router as seasons_router
from app.config import settings


_INSECURE_JWT_SECRET_DEFAULT = "dev-insecure-change-me"


def create_app() -> FastAPI:
    # Fail loudly if jwt_secret is still the dev default in production
    if os.environ.get("ENVIRONMENT") == "production":
        if settings.jwt_secret == _INSECURE_JWT_SECRET_DEFAULT:
            raise RuntimeError(
                "JWT_SECRET environment variable must be set to a secure value in production. "
                "The current jwt_secret is the insecure dev default. "
                "Please set the JWT_SECRET environment variable before starting the app."
            )
    app = FastAPI(title="Insight2Redraft API")
    app.include_router(auth_router)
    app.include_router(seasons_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_seasons.py -v`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add app/api/public_schemas.py app/api/seasons.py app/main.py tests/conftest.py tests/api/test_seasons.py
git commit -m "feat: add public /seasons read endpoints + shared seed fixture"
```

---

### Task 2: League & team schemas + `/leagues/{id}` (standings) + `/teams/{id}`

**Files:**
- Modify: `backend/app/api/public_schemas.py`
- Create: `backend/app/api/leagues.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/test_leagues.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.models.{League, Team, Owner, Season, WeeklyScore}`; schemas from Task 1; `seed`, `client` fixtures.
- Produces:
  - `public_schemas.OwnerRef {id: int, first_name: str, last_name: str, display_name: str | None, avatar_url: str | None}`
  - `public_schemas.TeamStanding {team_id: int, owner: OwnerRef | None, wins: int, losses: int, ties: int, points_for: float, points_against: float, league_finish: int | None}`
  - `public_schemas.LeagueDetail {id: int, name: str, season_id: int, season_year: int, scoring_validated: bool, standings: list[TeamStanding]}`
  - `public_schemas.WeeklyScoreEntry {week: int, points: float, is_final: bool}`
  - `public_schemas.TeamDetail {id: int, league_id: int, league_name: str, season_year: int, owner: OwnerRef | None, wins: int, losses: int, ties: int, points_for: float, points_against: float, league_finish: int | None, weekly_scores: list[WeeklyScoreEntry]}`
  - `app.api.leagues.router` — `APIRouter(tags=["public"])` with `GET /leagues/{league_id}`, `GET /teams/{team_id}`, mounted in `create_app()`.
  - Module helper `_win_pct(team) -> float` used for standings ordering.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_leagues.py`:

```python
def test_league_standings_ordered_by_winpct_then_points(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    # Insert deliberately out of standings order.
    low = seed.team(league, wins=1, losses=3, points_for=90)
    high = seed.team(league, wins=3, losses=1, points_for=120)
    tie_pf = seed.team(league, wins=3, losses=1, points_for=150)  # same record, more PF
    winless = seed.team(league, wins=0, losses=0, ties=0, points_for=200)  # no games -> last
    resp = client.get(f"/leagues/{league.id}")
    assert resp.status_code == 200
    order = [t["team_id"] for t in resp.json()["standings"]]
    assert order == [tie_pf.id, high.id, low.id, winless.id]


def test_league_includes_owner_of_record_and_null_owner(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    owner = seed.owner(first_name="Jack", last_name="Altiere", display_name="Commish")
    seed.team(league, owner=owner, wins=2, losses=0, points_for=100)
    seed.team(league, owner=None, wins=1, losses=1, points_for=80)
    body = client.get(f"/leagues/{league.id}").json()
    owners = [t["owner"] for t in body["standings"]]
    assert owners[0] == {
        "id": owner.id, "first_name": "Jack", "last_name": "Altiere",
        "display_name": "Commish", "avatar_url": None,
    }
    assert owners[1] is None


def test_league_unknown_returns_404(client):
    assert client.get("/leagues/999999").status_code == 404


def test_team_detail_weekly_scores_ordered_by_week(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, wins=1, losses=0, points_for=100)
    seed.weekly(team, week=2, sleeper_points=110)
    seed.weekly(team, week=1, sleeper_points=100)
    body = client.get(f"/teams/{team.id}").json()
    assert body["league_name"] == "Alpha"
    assert body["season_year"] == 2025
    assert [(w["week"], w["points"]) for w in body["weekly_scores"]] == [(1, 100.0), (2, 110.0)]


def test_team_unknown_returns_404(client):
    assert client.get("/teams/999999").status_code == 404


def test_public_league_and_team_hide_scoring_internals(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    owner = seed.owner(email="secret@example.com", notes="internal note")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    seed.weekly(team, week=1, sleeper_points=100, recomputed_points=95,
                bench_points=30, mismatch_flag=True)
    forbidden = ("recomputed_points", "bench_points", "mismatch_flag",
                 "email", "notes", "secret@example.com", "internal note")
    for path in (f"/leagues/{league.id}", f"/teams/{team.id}"):
        text = client.get(path).text
        for token in forbidden:
            assert token not in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_leagues.py -v`
Expected: FAIL — 404 for all (router not mounted).

- [ ] **Step 3: Add the league/team schemas**

Append to `backend/app/api/public_schemas.py`:

```python
class OwnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    display_name: str | None
    avatar_url: str | None


class TeamStanding(BaseModel):
    team_id: int
    owner: OwnerRef | None
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


class LeagueDetail(BaseModel):
    id: int
    name: str
    season_id: int
    season_year: int
    scoring_validated: bool
    standings: list[TeamStanding]


class WeeklyScoreEntry(BaseModel):
    week: int
    points: float
    is_final: bool


class TeamDetail(BaseModel):
    id: int
    league_id: int
    league_name: str
    season_year: int
    owner: OwnerRef | None
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None
    weekly_scores: list[WeeklyScoreEntry]
```

- [ ] **Step 4: Implement the leagues/teams router**

Create `backend/app/api/leagues.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import (
    LeagueDetail,
    OwnerRef,
    TeamDetail,
    TeamStanding,
    WeeklyScoreEntry,
)
from app.db import get_db
from app.models import League, Owner, Season, Team, WeeklyScore

router = APIRouter(tags=["public"])


def _win_pct(team: Team) -> float:
    games = team.wins + team.losses + team.ties
    if games == 0:
        return -1.0
    return (team.wins + 0.5 * team.ties) / games


def _owner_ref(db: Session, owner_id: int | None) -> OwnerRef | None:
    if owner_id is None:
        return None
    owner = db.get(Owner, owner_id)
    return OwnerRef.model_validate(owner) if owner is not None else None


def _standing(db: Session, team: Team) -> TeamStanding:
    return TeamStanding(
        team_id=team.id,
        owner=_owner_ref(db, team.owner_id),
        wins=team.wins,
        losses=team.losses,
        ties=team.ties,
        points_for=float(team.points_for),
        points_against=float(team.points_against),
        league_finish=team.league_finish,
    )


@router.get("/leagues/{league_id}", response_model=LeagueDetail)
def get_league(league_id: int, db: Session = Depends(get_db)) -> LeagueDetail:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = db.get(Season, league.season_id)
    teams = db.execute(
        select(Team).where(Team.league_id == league_id)
    ).scalars().all()
    ordered = sorted(teams, key=lambda t: (_win_pct(t), float(t.points_for)), reverse=True)
    return LeagueDetail(
        id=league.id,
        name=league.name,
        season_id=league.season_id,
        season_year=season.year,
        scoring_validated=league.scoring_validated,
        standings=[_standing(db, t) for t in ordered],
    )


@router.get("/teams/{team_id}", response_model=TeamDetail)
def get_team(team_id: int, db: Session = Depends(get_db)) -> TeamDetail:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    league = db.get(League, team.league_id)
    season = db.get(Season, league.season_id)
    weeks = db.execute(
        select(WeeklyScore)
        .where(WeeklyScore.team_id == team_id)
        .order_by(WeeklyScore.week)
    ).scalars().all()
    return TeamDetail(
        id=team.id,
        league_id=team.league_id,
        league_name=league.name,
        season_year=season.year,
        owner=_owner_ref(db, team.owner_id),
        wins=team.wins,
        losses=team.losses,
        ties=team.ties,
        points_for=float(team.points_for),
        points_against=float(team.points_against),
        league_finish=team.league_finish,
        weekly_scores=[
            WeeklyScoreEntry(week=ws.week, points=float(ws.sleeper_points), is_final=ws.is_final)
            for ws in weeks
        ],
    )
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include after `seasons_router`:

```python
from app.api.leagues import router as leagues_router
```
```python
    app.include_router(seasons_router)
    app.include_router(leagues_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_leagues.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/public_schemas.py app/api/leagues.py app/main.py tests/api/test_leagues.py
git commit -m "feat: add public /leagues (standings) + /teams read endpoints"
```

---

### Task 3: History aggregation service

**Files:**
- Create: `backend/app/history/__init__.py`
- Create: `backend/app/history/service.py`
- Test: `backend/tests/history/__init__.py`, `backend/tests/history/test_service.py`

**Interfaces:**
- Consumes: `app.models.{Team, League, Season, WeeklyScore}`; `seed`, `db_session` fixtures.
- Produces (for Task 4, from `app.history.service`):
  - `@dataclass SeasonRecordRow {season_year: int, league_id: int, league_name: str, wins: int, losses: int, ties: int, points_for: float, points_against: float, league_finish: int | None}`
  - `@dataclass BestWeeklyRow {season_year: int, league_name: str, week: int, points: float}`
  - `owner_season_records(db: Session, owner_id: int) -> list[SeasonRecordRow]` — one row per team the owner held, ordered by `season_year` desc then `league_name`.
  - `owner_best_weekly(db: Session, owner_id: int, limit: int = 5) -> list[BestWeeklyRow]` — top `limit` weekly scores by `sleeper_points` desc across all the owner's teams.

- [ ] **Step 1: Write the failing tests**

Create empty `backend/tests/history/__init__.py`.

Create `backend/tests/history/test_service.py`:

```python
from app.history.service import owner_best_weekly, owner_season_records
from app.models import SeasonStatus


def test_owner_season_records_across_leagues_and_years(db_session, seed):
    owner = seed.owner()
    s2024 = seed.season(2024, status=SeasonStatus.COMPLETE)
    s2025 = seed.season(2025)
    la = seed.league(s2024, name="Alpha")
    lb = seed.league(s2025, name="Beta")
    seed.team(la, owner=owner, wins=8, losses=6, points_for=1500, league_finish=3)
    seed.team(lb, owner=owner, wins=10, losses=4, points_for=1700, league_finish=1)

    rows = owner_season_records(db_session, owner.id)

    assert [(r.season_year, r.league_name) for r in rows] == [(2025, "Beta"), (2024, "Alpha")]
    assert rows[0].wins == 10 and rows[0].league_finish == 1
    assert rows[1].points_for == 1500.0


def test_owner_season_records_empty_for_owner_without_teams(db_session, seed):
    owner = seed.owner()
    assert owner_season_records(db_session, owner.id) == []


def test_owner_best_weekly_ranks_and_limits(db_session, seed):
    owner = seed.owner()
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    for week, pts in [(1, 90), (2, 150), (3, 120), (4, 60)]:
        seed.weekly(team, week=week, sleeper_points=pts)

    rows = owner_best_weekly(db_session, owner.id, limit=2)

    assert [(r.week, r.points) for r in rows] == [(2, 150.0), (3, 120.0)]
    assert rows[0].season_year == 2025 and rows[0].league_name == "Alpha"


def test_owner_best_weekly_default_limit_is_five(db_session, seed):
    owner = seed.owner()
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    for week in range(1, 8):  # 7 weeks
        seed.weekly(team, week=week, sleeper_points=week * 10)

    rows = owner_best_weekly(db_session, owner.id)
    assert len(rows) == 5
    assert rows[0].points == 70.0  # week 7, highest
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/history/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.history'`.

- [ ] **Step 3: Implement the history service**

Create empty `backend/app/history/__init__.py`.

Create `backend/app/history/service.py`:

```python
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import League, Season, Team, WeeklyScore


@dataclass
class SeasonRecordRow:
    season_year: int
    league_id: int
    league_name: str
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


@dataclass
class BestWeeklyRow:
    season_year: int
    league_name: str
    week: int
    points: float


def owner_season_records(db: Session, owner_id: int) -> list[SeasonRecordRow]:
    rows = db.execute(
        select(Team, League, Season)
        .join(League, Team.league_id == League.id)
        .join(Season, League.season_id == Season.id)
        .where(Team.owner_id == owner_id)
        .order_by(Season.year.desc(), League.name)
    ).all()
    return [
        SeasonRecordRow(
            season_year=season.year,
            league_id=league.id,
            league_name=league.name,
            wins=team.wins,
            losses=team.losses,
            ties=team.ties,
            points_for=float(team.points_for),
            points_against=float(team.points_against),
            league_finish=team.league_finish,
        )
        for team, league, season in rows
    ]


def owner_best_weekly(db: Session, owner_id: int, limit: int = 5) -> list[BestWeeklyRow]:
    rows = db.execute(
        select(WeeklyScore, League, Season)
        .join(Team, WeeklyScore.team_id == Team.id)
        .join(League, Team.league_id == League.id)
        .join(Season, League.season_id == Season.id)
        .where(Team.owner_id == owner_id)
        .order_by(WeeklyScore.sleeper_points.desc())
        .limit(limit)
    ).all()
    return [
        BestWeeklyRow(
            season_year=season.year,
            league_name=league.name,
            week=ws.week,
            points=float(ws.sleeper_points),
        )
        for ws, league, season in rows
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/history/test_service.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add app/history/ tests/history/
git commit -m "feat: add owner history aggregation service"
```

---

### Task 4: Owner schemas + `/owners/{id}` endpoint + full-suite verification

**Files:**
- Modify: `backend/app/api/public_schemas.py`
- Create: `backend/app/api/owners.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/test_owners.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.models.Owner`; `app.history.service.{owner_season_records, owner_best_weekly, SeasonRecordRow, BestWeeklyRow}`; schemas from Tasks 1–2; `seed`, `client` fixtures.
- Produces:
  - `public_schemas.OwnerSeasonRecord {season_year: int, league_id: int, league_name: str, wins: int, losses: int, ties: int, points_for: float, points_against: float, league_finish: int | None}` (`from_attributes=True`)
  - `public_schemas.BestWeeklyEntry {season_year: int, league_name: str, week: int, points: float}` (`from_attributes=True`)
  - `public_schemas.OwnerProfile {id: int, first_name: str, last_name: str, display_name: str | None, avatar_url: str | None, season_records: list[OwnerSeasonRecord], best_weekly: list[BestWeeklyEntry]}`
  - `app.api.owners.router` — `APIRouter(tags=["public"])` with `GET /owners/{owner_id}`, mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_owners.py`:

```python
def test_owner_profile_identity_records_and_best_weekly(client, seed):
    owner = seed.owner(first_name="Jack", last_name="Altiere", display_name="Commish")
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=10, losses=4, points_for=1700, league_finish=1)
    seed.weekly(team, week=1, sleeper_points=120)
    seed.weekly(team, week=2, sleeper_points=150)

    body = client.get(f"/owners/{owner.id}").json()

    assert body["first_name"] == "Jack"
    assert body["display_name"] == "Commish"
    assert len(body["season_records"]) == 1
    assert body["season_records"][0] == {
        "season_year": 2025, "league_id": league.id, "league_name": "Alpha",
        "wins": 10, "losses": 4, "ties": 0,
        "points_for": 1700.0, "points_against": 0.0, "league_finish": 1,
    }
    assert [(w["week"], w["points"]) for w in body["best_weekly"]] == [(2, 150.0), (1, 120.0)]


def test_owner_profile_empty_history(client, seed):
    owner = seed.owner()
    body = client.get(f"/owners/{owner.id}").json()
    assert body["season_records"] == []
    assert body["best_weekly"] == []


def test_owner_unknown_returns_404(client):
    assert client.get("/owners/999999").status_code == 404


def test_owner_profile_hides_pii(client, seed):
    owner = seed.owner(email="secret@example.com", notes="internal note")
    text = client.get(f"/owners/{owner.id}").text
    for token in ("email", "notes", "secret@example.com", "internal note"):
        assert token not in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_owners.py -v`
Expected: FAIL — 404 for all (router not mounted).

- [ ] **Step 3: Add the owner schemas**

Append to `backend/app/api/public_schemas.py`:

```python
class OwnerSeasonRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season_year: int
    league_id: int
    league_name: str
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


class BestWeeklyEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season_year: int
    league_name: str
    week: int
    points: float


class OwnerProfile(BaseModel):
    id: int
    first_name: str
    last_name: str
    display_name: str | None
    avatar_url: str | None
    season_records: list[OwnerSeasonRecord]
    best_weekly: list[BestWeeklyEntry]
```

- [ ] **Step 4: Implement the owners router**

Create `backend/app/api/owners.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.public_schemas import BestWeeklyEntry, OwnerProfile, OwnerSeasonRecord
from app.db import get_db
from app.history.service import owner_best_weekly, owner_season_records
from app.models import Owner

router = APIRouter(tags=["public"])


@router.get("/owners/{owner_id}", response_model=OwnerProfile)
def get_owner(owner_id: int, db: Session = Depends(get_db)) -> OwnerProfile:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    return OwnerProfile(
        id=owner.id,
        first_name=owner.first_name,
        last_name=owner.last_name,
        display_name=owner.display_name,
        avatar_url=owner.avatar_url,
        season_records=[
            OwnerSeasonRecord.model_validate(r) for r in owner_season_records(db, owner_id)
        ],
        best_weekly=[
            BestWeeklyEntry.model_validate(r) for r in owner_best_weekly(db, owner_id)
        ],
    )
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include after `leagues_router`:

```python
from app.api.owners import router as owners_router
```
```python
    app.include_router(leagues_router)
    app.include_router(owners_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_owners.py -v`
Expected: 4 passed.

- [ ] **Step 7: Run the full suite**

Run: `uv run pytest`
Expected: 132 passed (114 pre-existing + 18 new: 4 seasons + 6 leagues + 4 history + 4 owners), only the known baseline warnings (PyJWT `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

- [ ] **Step 8: Commit**

```bash
git add app/api/public_schemas.py app/api/owners.py app/main.py tests/api/test_owners.py
git commit -m "feat: add public /owners profile read endpoint"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green.
- Manual smoke (optional, needs dev DB): `uv run uvicorn app.main:app`, then `curl localhost:8000/seasons`, `curl localhost:8000/leagues/1`, `curl localhost:8000/owners/1` — confirm shapes and that no response contains `recomputed_points`, `bench_points`, `mismatch_flag`, `email`, or `notes`.
