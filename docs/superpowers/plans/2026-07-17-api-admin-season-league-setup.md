# Admin: Season & League Setup (API-3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super-Admin API endpoints to create/edit seasons, enter a Sleeper league (running `sync_league_setup` synchronously to validate scoring and create teams), re-run that setup as a validation review, and remove a league.

**Architecture:** A new `app/api/admin/` subpackage (routers under `/admin`, gated by API-1's `require_super_admin`). League entry reuses the existing `SyncService` synchronously via a request-scoped `SleeperClient` dependency. A small shared `resolve_ruleset` helper (extracted from the worker's `cycle.py`) resolves a season's ruleset or falls back to `DEFAULT_PPR`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, httpx (SleeperClient), pytest + FastAPI `TestClient` with `MockTransport`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-api-admin-season-league-setup-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- Postgres REQUIRED for tests — container `Insight2Redraft` on localhost:5432 (test DB `insight2redraft_test`).
- **Every `/admin` endpoint is Super-Admin-only** via `dependencies=[Depends(require_super_admin)]` on the router. 401 without a token, 403 for a non-super-admin.
- **Write endpoints must `db.commit()`** — `SyncService` only flushes, and `get_db` does not commit.
- **Error mapping:** unknown season/league id → 404; duplicate season year → 409; `SleeperNotFound` → 422; `SleeperUnavailable`/other `SleeperError`/`SyncError` → 502; malformed body → FastAPI 422.
- **Ruleset fallback:** when `season.scoring_ruleset_id` is null, use `DEFAULT_PPR`.
- **`diffs` are admin-only** — never added to any public (API-2) response.
- No new dependencies. No pagination.
- Known warning baseline in test output: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/sync/ruleset.py`, `app/api/admin/__init__.py`, `app/api/admin/schemas.py`, `app/api/admin/seasons.py`, `app/api/admin/leagues.py`
- Modify: `app/worker/cycle.py` (use the helper), `app/api/deps.py` (add `get_sleeper_client`), `app/main.py` (mount admin routers)
- Test: `tests/sync/test_ruleset.py`, `tests/api/admin/__init__.py`, `tests/api/admin/conftest.py`, `tests/api/admin/test_seasons.py`, `tests/api/admin/test_leagues.py`

Reused: `tests/api/conftest.py` (`app`, `client`, `make_account`); `tests/conftest.py` (`db_session`, `seed`); `tests/sync/conftest.py` (`route_client`, `load_fixture`); API-1 `app.api.security.create_access_token`, `app.api.deps.require_super_admin`; recorded fixtures `tests/sleeper/fixtures/{league,users,rosters}.json`.

---

### Task 1: `resolve_ruleset` helper + worker refactor

**Files:**
- Create: `backend/app/sync/ruleset.py`
- Modify: `backend/app/worker/cycle.py`
- Test: `backend/tests/sync/test_ruleset.py`

**Interfaces:**
- Consumes: `app.models.{Season, ScoringRuleset}`; `app.scoring.rulesets.DEFAULT_PPR`.
- Produces: `app.sync.ruleset.resolve_ruleset(session: Session, season: Season) -> Mapping[str, float]` — returns the season's `ScoringRuleset.rules` when `scoring_ruleset_id` is set and the row exists, else `DEFAULT_PPR`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/sync/test_ruleset.py`:

```python
from app.models import ScoringRuleset, Season
from app.scoring.rulesets import DEFAULT_PPR
from app.sync.ruleset import resolve_ruleset


def test_resolve_ruleset_returns_row_rules_when_set(db_session):
    rs = ScoringRuleset(name="custom", rules={"rec": 0.5})
    db_session.add(rs)
    db_session.flush()
    season = Season(year=2031, scoring_ruleset_id=rs.id)
    db_session.add(season)
    db_session.flush()

    assert resolve_ruleset(db_session, season) == {"rec": 0.5}


def test_resolve_ruleset_falls_back_to_default_ppr_when_unset(db_session):
    season = Season(year=2032)
    db_session.add(season)
    db_session.flush()

    assert resolve_ruleset(db_session, season) is DEFAULT_PPR
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/sync/test_ruleset.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sync.ruleset'`.

- [ ] **Step 3: Implement the helper**

Create `backend/app/sync/ruleset.py`:

```python
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.models import ScoringRuleset, Season
from app.scoring.rulesets import DEFAULT_PPR


def resolve_ruleset(session: Session, season: Season) -> Mapping[str, float]:
    """The season's configured ruleset rows, or DEFAULT_PPR when unset/missing."""
    if season.scoring_ruleset_id is not None:
        row = session.get(ScoringRuleset, season.scoring_ruleset_id)
        if row is not None:
            return row.rules
    return DEFAULT_PPR
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/sync/test_ruleset.py -v`
Expected: 2 passed.

- [ ] **Step 5: Refactor the worker to use the helper**

In `backend/app/worker/cycle.py`, replace the inline resolution. Change the imports:

```python
from app.models import League, Season, SeasonStatus, Team, WeeklyScore
from app.sleeper.client import SleeperClient
from app.sleeper.models import NflState
from app.sync.ruleset import resolve_ruleset
from app.sync.service import SyncService
```

(Remove `ScoringRuleset` from the `app.models` import and delete the `from app.scoring.rulesets import DEFAULT_PPR` line — both become unused here.)

Then replace these lines inside `run_cycle`:

```python
        ruleset_row = (
            session.get(ScoringRuleset, season.scoring_ruleset_id)
            if season.scoring_ruleset_id
            else None
        )
        ruleset = ruleset_row.rules if ruleset_row else DEFAULT_PPR
```

with:

```python
        ruleset = resolve_ruleset(session, season)
```

- [ ] **Step 6: Run the worker suite to confirm no regression**

Run: `uv run pytest tests/sync/test_ruleset.py tests/worker/ -v`
Expected: all pass (2 ruleset + the existing worker tests), no new warnings.

- [ ] **Step 7: Commit**

```bash
git add app/sync/ruleset.py app/worker/cycle.py tests/sync/test_ruleset.py
git commit -m "refactor: extract resolve_ruleset helper shared by worker + admin API"
```

---

### Task 2: Admin season schemas + `/admin/seasons` CRUD + auth

**Files:**
- Create: `backend/app/api/admin/__init__.py`, `backend/app/api/admin/schemas.py`, `backend/app/api/admin/seasons.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/admin/__init__.py`, `backend/tests/api/admin/conftest.py`, `backend/tests/api/admin/test_seasons.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.require_super_admin`; `app.models.{Season, SeasonStatus}`; fixtures `app`, `client`, `make_account`, `seed`.
- Produces:
  - `admin.schemas.SeasonCreate {year: int, scoring_ruleset_id: int | None = None, playoff_field_per_league: int = 2, nfl_playoff_weeks: list[int] = [], status: SeasonStatus = SeasonStatus.SETUP}`
  - `admin.schemas.SeasonUpdate {scoring_ruleset_id: int | None = None, playoff_field_per_league: int | None = None, nfl_playoff_weeks: list[int] | None = None, status: SeasonStatus | None = None}`
  - `admin.schemas.SeasonAdminResponse {id, year, status: SeasonStatus, scoring_ruleset_id: int | None, playoff_field_per_league: int, nfl_playoff_weeks: list[int]}` (`from_attributes=True`)
  - `app.api.admin.seasons.router` — `APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])` with `POST /admin/seasons`, `PATCH /admin/seasons/{season_id}`, mounted in `create_app()`.
  - Test fixtures in `tests/api/admin/conftest.py`: `super_admin` (a SUPER_ADMIN `Account`), `admin_headers` (a bearer-token header dict for it). Used by Task 3.

- [ ] **Step 1: Write the admin auth fixtures + failing tests**

Create empty `backend/tests/api/admin/__init__.py`.

Create `backend/tests/api/admin/conftest.py`:

```python
import pytest

from app.api.security import create_access_token
from app.models import AccountRole


@pytest.fixture()
def super_admin(make_account):
    return make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)


@pytest.fixture()
def admin_headers(super_admin):
    token = create_access_token(super_admin.id, super_admin.role)
    return {"Authorization": f"Bearer {token}"}
```

Create `backend/tests/api/admin/test_seasons.py`:

```python
from app.api.security import create_access_token
from app.models import AccountRole, Season, SeasonStatus


def test_create_season_requires_token(client):
    resp = client.post("/admin/seasons", json={"year": 2025})
    assert resp.status_code == 401


def test_create_season_forbidden_for_league_admin(client, make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    headers = {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}
    resp = client.post("/admin/seasons", json={"year": 2025}, headers=headers)
    assert resp.status_code == 403


def test_create_season_succeeds_for_super_admin(client, admin_headers, db_session):
    resp = client.post(
        "/admin/seasons",
        json={"year": 2025, "playoff_field_per_league": 3, "nfl_playoff_weeks": [15, 16, 17]},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["year"] == 2025
    assert body["status"] == "setup"
    assert body["playoff_field_per_league"] == 3
    row = db_session.query(Season).filter_by(year=2025).one()
    assert row.nfl_playoff_weeks == [15, 16, 17]


def test_create_season_duplicate_year_returns_409(client, admin_headers, seed):
    seed.season(2025, status=SeasonStatus.REGULAR)
    resp = client.post("/admin/seasons", json={"year": 2025}, headers=admin_headers)
    assert resp.status_code == 409


def test_patch_season_updates_fields(client, admin_headers, seed):
    season = seed.season(2025, status=SeasonStatus.SETUP)
    resp = client.patch(
        f"/admin/seasons/{season.id}",
        json={"status": "regular", "playoff_field_per_league": 4},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "regular"
    assert body["playoff_field_per_league"] == 4


def test_patch_unknown_season_returns_404(client, admin_headers):
    resp = client.patch("/admin/seasons/999999", json={"status": "regular"}, headers=admin_headers)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_seasons.py -v`
Expected: FAIL — 404 on `/admin/seasons` (router not mounted).

- [ ] **Step 3: Implement the season schemas**

Create empty `backend/app/api/admin/__init__.py`.

Create `backend/app/api/admin/schemas.py`:

```python
from pydantic import BaseModel, ConfigDict, Field

from app.models import SeasonStatus


class SeasonCreate(BaseModel):
    year: int
    scoring_ruleset_id: int | None = None
    playoff_field_per_league: int = 2
    nfl_playoff_weeks: list[int] = Field(default_factory=list)
    status: SeasonStatus = SeasonStatus.SETUP


class SeasonUpdate(BaseModel):
    scoring_ruleset_id: int | None = None
    playoff_field_per_league: int | None = None
    nfl_playoff_weeks: list[int] | None = None
    status: SeasonStatus | None = None


class SeasonAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus
    scoring_ruleset_id: int | None
    playoff_field_per_league: int
    nfl_playoff_weeks: list[int]
```

- [ ] **Step 4: Implement the seasons router**

Create `backend/app/api/admin/seasons.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import SeasonAdminResponse, SeasonCreate, SeasonUpdate
from app.api.deps import require_super_admin
from app.db import get_db
from app.models import Season

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


@router.post("/seasons", response_model=SeasonAdminResponse, status_code=201)
def create_season(body: SeasonCreate, db: Session = Depends(get_db)) -> Season:
    existing = db.execute(
        select(Season).where(Season.year == body.year)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Season year already exists")
    season = Season(
        year=body.year,
        scoring_ruleset_id=body.scoring_ruleset_id,
        playoff_field_per_league=body.playoff_field_per_league,
        nfl_playoff_weeks=body.nfl_playoff_weeks,
        status=body.status,
    )
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


@router.patch("/seasons/{season_id}", response_model=SeasonAdminResponse)
def update_season(
    season_id: int, body: SeasonUpdate, db: Session = Depends(get_db)
) -> Season:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(season, field, value)
    db.commit()
    db.refresh(season)
    return season
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include after the existing routers:

```python
from app.api.admin.seasons import router as admin_seasons_router
```
```python
    app.include_router(owners_router)
    app.include_router(admin_seasons_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_seasons.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/__init__.py app/api/admin/schemas.py app/api/admin/seasons.py app/main.py tests/api/admin/
git commit -m "feat: add admin season CRUD endpoints (super-admin only)"
```

---

### Task 3: `get_sleeper_client` + league entry / resync / delete + full suite

**Files:**
- Modify: `backend/app/api/deps.py`
- Modify: `backend/app/api/admin/schemas.py`
- Create: `backend/app/api/admin/leagues.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/admin/test_leagues.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.{require_super_admin, get_sleeper_client}`; `app.sync.service.SyncService`; `app.sync.ruleset.resolve_ruleset`; `app.sleeper.errors.{SleeperError, SleeperNotFound}`; `app.sync.errors.SyncError`; `app.models.{Season, League, Team}`; fixtures `app`, `client`, `admin_headers`, `db_session`, `seed`; `tests.sync.conftest.{route_client, load_fixture}`.
- Produces:
  - `app.api.deps.get_sleeper_client()` — async generator dependency yielding a `SleeperClient`, closed in `finally`.
  - `admin.schemas.{LeagueEntryRequest, ScoringDiff, TeamRef, LeagueSetupResponse}` (shapes below).
  - `app.api.admin.leagues.router` — `APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])` with `POST /admin/seasons/{season_id}/leagues`, `POST /admin/leagues/{league_id}/resync-setup`, `DELETE /admin/leagues/{league_id}`, mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/admin/test_leagues.py`:

```python
import httpx

from app.api.deps import get_sleeper_client
from app.models import League, ScoringRuleset, Season, Team
from app.sleeper.client import SleeperClient
from tests.sync.conftest import load_fixture, route_client

_MATCHING = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}


def _league_routes():
    return {
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321": load_fixture("league.json"),
    }


async def _noop_sleep(_seconds: float) -> None:
    return None


def _failing_client(status: int) -> SleeperClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


def _use_client(app, client_obj):
    app.dependency_overrides[get_sleeper_client] = lambda: client_obj


def test_enter_league_validated_true(app, client, admin_headers, db_session, seed):
    rs = ScoringRuleset(name="match", rules=_MATCHING)
    db_session.add(rs)
    db_session.flush()
    season = seed.season(2024, scoring_ruleset_id=rs.id)
    _use_client(app, route_client(_league_routes()))

    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Alpha League"
    assert body["scoring_validated"] is True
    assert body["diffs"] == []
    assert {t["sleeper_roster_id"] for t in body["teams"]} == {1, 2}
    assert db_session.query(League).filter_by(sleeper_league_id="987654321").count() == 1


def test_enter_league_reports_diffs(app, client, admin_headers, db_session, seed):
    rs = ScoringRuleset(name="mismatch", rules={**_MATCHING, "pass_td": 6.0})
    db_session.add(rs)
    db_session.flush()
    season = seed.season(2024, scoring_ruleset_id=rs.id)
    _use_client(app, route_client(_league_routes()))

    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["scoring_validated"] is False
    assert {
        "category": "pass_td", "league_value": 4.0, "platform_value": 6.0
    } in body["diffs"]


def test_enter_league_idempotent(app, client, admin_headers, db_session, seed):
    season = seed.season(2024)
    _use_client(app, route_client(_league_routes()))
    for _ in range(2):
        resp = client.post(
            f"/admin/seasons/{season.id}/leagues",
            json={"sleeper_league_id": "987654321"},
            headers=admin_headers,
        )
        assert resp.status_code == 201
    assert db_session.query(League).filter_by(sleeper_league_id="987654321").count() == 1


def test_enter_league_unknown_season_404(app, client, admin_headers):
    _use_client(app, route_client(_league_routes()))
    resp = client.post(
        "/admin/seasons/999999/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_enter_league_sleeper_not_found_422(app, client, admin_headers, seed):
    season = seed.season(2024)
    _use_client(app, route_client({}))  # every path -> 404 -> SleeperNotFound
    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "000"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_enter_league_sleeper_unavailable_502(app, client, admin_headers, seed):
    season = seed.season(2024)
    _use_client(app, _failing_client(500))
    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 502


def test_resync_setup_returns_fresh_result(app, client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = League(season_id=season.id, sleeper_league_id="987654321", name="old name")
    db_session.add(league)
    db_session.flush()
    _use_client(app, route_client(_league_routes()))

    resp = client.post(f"/admin/leagues/{league.id}/resync-setup", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["league_id"] == league.id
    assert body["name"] == "Alpha League"  # refreshed from Sleeper


def test_resync_unknown_league_404(app, client, admin_headers):
    _use_client(app, route_client(_league_routes()))
    resp = client.post("/admin/leagues/999999/resync-setup", headers=admin_headers)
    assert resp.status_code == 404


def test_delete_league_cascades_teams(client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    seed.team(league, wins=1, losses=0, points_for=100)
    league_id = league.id

    resp = client.delete(f"/admin/leagues/{league_id}", headers=admin_headers)
    assert resp.status_code == 204
    assert db_session.get(League, league_id) is None
    assert db_session.query(Team).filter_by(league_id=league_id).count() == 0


def test_delete_unknown_league_404(client, admin_headers):
    resp = client.delete("/admin/leagues/999999", headers=admin_headers)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_leagues.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_sleeper_client' from 'app.api.deps'`.

- [ ] **Step 3: Add the `get_sleeper_client` dependency**

Append to `backend/app/api/deps.py` (add `from collections.abc import AsyncGenerator` to its imports, and `from app.sleeper.client import SleeperClient`):

```python
async def get_sleeper_client() -> AsyncGenerator[SleeperClient, None]:
    client = SleeperClient()
    try:
        yield client
    finally:
        await client.aclose()
```

- [ ] **Step 4: Add the league schemas**

Append to `backend/app/api/admin/schemas.py`:

```python
class LeagueEntryRequest(BaseModel):
    sleeper_league_id: str


class ScoringDiff(BaseModel):
    category: str
    league_value: float
    platform_value: float


class TeamRef(BaseModel):
    team_id: int
    sleeper_roster_id: int
    sleeper_user_id: str | None


class LeagueSetupResponse(BaseModel):
    league_id: int
    name: str
    scoring_validated: bool
    diffs: list[ScoringDiff]
    teams: list[TeamRef]
```

- [ ] **Step 5: Implement the leagues router**

Create `backend/app/api/admin/leagues.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    LeagueEntryRequest,
    LeagueSetupResponse,
    ScoringDiff,
    TeamRef,
)
from app.api.deps import get_sleeper_client, require_super_admin
from app.db import get_db
from app.models import League, Season, Team
from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperError, SleeperNotFound
from app.sync.errors import SyncError
from app.sync.ruleset import resolve_ruleset
from app.sync.service import LeagueSyncResult, SyncService

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _build_response(db: Session, result: LeagueSyncResult) -> LeagueSetupResponse:
    league = db.get(League, result.league_id)
    teams = db.execute(
        select(Team).where(Team.league_id == result.league_id)
    ).scalars().all()
    return LeagueSetupResponse(
        league_id=league.id,
        name=league.name,
        scoring_validated=result.scoring_validated,
        diffs=[
            ScoringDiff(category=c, league_value=lv, platform_value=pv)
            for c, lv, pv in result.diffs
        ],
        teams=[
            TeamRef(
                team_id=t.id,
                sleeper_roster_id=t.sleeper_roster_id,
                sleeper_user_id=t.sleeper_user_id,
            )
            for t in teams
        ],
    )


async def _run_setup(
    db: Session, client: SleeperClient, season: Season, sleeper_league_id: str
) -> LeagueSetupResponse:
    ruleset = resolve_ruleset(db, season)
    service = SyncService(client, db, season, ruleset)
    try:
        result = await service.sync_league_setup(sleeper_league_id)
    except SleeperNotFound:
        raise HTTPException(status_code=422, detail="Sleeper league not found")
    except (SleeperError, SyncError):
        raise HTTPException(status_code=502, detail="Sleeper upstream error")
    db.commit()
    return _build_response(db, result)


@router.post(
    "/seasons/{season_id}/leagues",
    response_model=LeagueSetupResponse,
    status_code=201,
)
async def enter_league(
    season_id: int,
    body: LeagueEntryRequest,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
) -> LeagueSetupResponse:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return await _run_setup(db, client, season, body.sleeper_league_id)


@router.post("/leagues/{league_id}/resync-setup", response_model=LeagueSetupResponse)
async def resync_league(
    league_id: int,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
) -> LeagueSetupResponse:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = db.get(Season, league.season_id)
    return await _run_setup(db, client, season, league.sleeper_league_id)


@router.delete("/leagues/{league_id}", status_code=204)
def delete_league(league_id: int, db: Session = Depends(get_db)) -> None:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    db.delete(league)
    db.commit()
```

- [ ] **Step 6: Wire the router into the app**

In `backend/app/main.py`, add the import and include after `admin_seasons_router`:

```python
from app.api.admin.leagues import router as admin_leagues_router
```
```python
    app.include_router(admin_seasons_router)
    app.include_router(admin_leagues_router)
```

- [ ] **Step 7: Run the league tests**

Run: `uv run pytest tests/api/admin/test_leagues.py -v`
Expected: 10 passed.

- [ ] **Step 8: Run the full suite**

Run: `uv run pytest`
Expected: 150 passed (132 pre-existing + 2 ruleset + 6 seasons + 10 leagues), only the known baseline warnings (PyJWT `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

- [ ] **Step 9: Commit**

```bash
git add app/api/deps.py app/api/admin/schemas.py app/api/admin/leagues.py app/main.py tests/api/admin/test_leagues.py
git commit -m "feat: add admin league entry, resync-setup, and delete endpoints"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green (expected 150).
- Manual smoke (optional, needs dev DB + a real Sleeper league id): create a super admin via the API-1 CLI, `POST /admin/seasons`, then `POST /admin/seasons/{id}/leagues` with a real `sleeper_league_id` and confirm the validation diffs + teams come back; confirm `diffs` never appear on any public `/seasons` or `/leagues` response.
