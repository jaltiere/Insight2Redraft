# Admin: Manual Sync Trigger + League-Admin Enablement (API-3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A synchronous per-league "sync now" endpoint plus super-admin management of League-Admin accounts and league grants, so League Admins can exist and refresh their own league on demand.

**Architecture:** Two new routers under `/admin`. `sync.py` exposes `POST /admin/leagues/{league_id}/sync`, guarded per-route by the reshaped `require_league_admin`, running `SyncService.sync_week` synchronously via the request-scoped `get_sleeper_client` (the admin-calls-Sleeper path already used in 3a/3b). `accounts.py` (router-level `require_super_admin`) exposes account CRUD-lite and account-nested grant/revoke. No model changes, no migration.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, httpx (SleeperClient via `MockTransport` in tests), pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-api-sync-trigger-la-enablement-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- Postgres REQUIRED for tests — test DB `insight2redraft_test`. Schema is built via `Base.metadata.create_all` (all tables already exist; this cycle adds no columns).
- **Write endpoints must `db.commit()`** — `get_db` does not commit.
- **Every `Account` is an admin** (roles only `super_admin` / `league_admin`), so "any admin" = a valid token; `require_super_admin` gates the accounts/grants router; `require_league_admin` (super-admin OR the granted league-admin) gates sync-now per-route.
- **Error mapping:** 401 no/invalid token; 403 wrong role or league not granted; sync-now 404 unknown league, 409 season not `REGULAR`/`PLAYOFFS` or not the current NFL season, 422 `SleeperNotFound`, 502 other `SleeperError`/`SyncError`; accounts 409 dup email or last-super-admin delete, 404 unknown account, 422 unknown `owner_id`; grants 404 unknown account/league or absent grant, 409 duplicate, 422 account not a league_admin.
- **Account responses never include `password_hash`.** Admin-only detail never leaks into public (API-2) responses.
- No new dependencies. No pagination.
- Known warning baseline in test output: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/api/admin/sync.py`, `app/api/admin/accounts.py`, `tests/api/admin/test_sync.py`, `tests/api/admin/test_accounts.py`
- Modify: `app/api/admin/schemas.py` (new schemas), `app/main.py` (mount both routers)

Reused: `tests/api/conftest.py` (`app`, `client`, `make_account`); `tests/api/admin/conftest.py` (`super_admin`, `admin_headers`); `tests/conftest.py` (`db_session`, `seed`); `tests/sync/conftest.py` (`route_client`, `load_fixture`); recorded fixtures `tests/sleeper/fixtures/{matchups,rosters}.json` and `weekly_stats.json`; `app.sync.service.SyncService`, `app.sync.ruleset.resolve_ruleset`; API-3b `app.api.deps.{require_league_admin, get_sleeper_client}`; `app.api.security.{hash_password, create_access_token}`.

Grounding (already in the codebase):
- `SyncService(client, session, season, ruleset)`; `sync_week(league_id, week) -> WeekSyncResult(scored_team_ids: list[int], skipped_roster_ids: list[int])`; methods flush, caller commits.
- `client.get_nfl_state() -> NflState(season: str, week: int, season_type: str, leg: int | None)`, fetched from `/state/nfl`.
- `route_client(routes)` returns a `SleeperClient` whose `MockTransport` returns `routes[suffix]` when `request.url.path.endswith(suffix)`, else 404. `load_fixture(name)` reads `tests/sync/fixtures` then `tests/sleeper/fixtures`.
- `Account(email unique, password_hash, role: AccountRole, owner_id FK owner)`, `AccountRole = SUPER_ADMIN | LEAGUE_ADMIN`; `LeagueAdminGrant(account_id FK account ON DELETE CASCADE, league_id FK league ON DELETE CASCADE)` unique `(account_id, league_id)`.
- `seed.season(year, status=..., **kw)`, `seed.league(season, name=..., **kw)` (default `sleeper_league_id=str(next)`), `seed.owner(**kw)` — all add+flush. `make_account(email, password, role=SUPER_ADMIN, owner_id=None)`.

---

### Task 1: Sync-now endpoint

**Files:**
- Create: `backend/app/api/admin/sync.py`, `backend/tests/api/admin/test_sync.py`
- Modify: `backend/app/api/admin/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.{require_league_admin, get_sleeper_client}`; `app.sync.service.SyncService`; `app.sync.ruleset.resolve_ruleset`; `app.models.{League, SeasonStatus, Team, WeeklyScore}`; `app.sleeper.errors.{SleeperError, SleeperNotFound}`; `app.sync.errors.SyncError`.
- Produces: `admin.schemas.SyncNowResponse {league_id: int, week: int, teams_synced: int, rosters_skipped: int, mismatches: int}`; `app.api.admin.sync.router` with `POST /admin/leagues/{league_id}/sync`, mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/admin/test_sync.py`:

```python
import httpx

from app.api.deps import get_sleeper_client
from app.api.security import create_access_token
from app.models import AccountRole, LeagueAdminGrant, ScoringRuleset, SeasonStatus
from app.sleeper.client import SleeperClient
from tests.sync.conftest import load_fixture, route_client

MATCHING_RULESET = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}
NFL_STATE = {"season": "2024", "week": 5, "season_type": "regular"}


def _sync_routes():
    return {
        "/state/nfl": NFL_STATE,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
    }


async def _noop_sleep(_seconds: float) -> None:
    return None


def _failing_client() -> SleeperClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


def _use_client(app, client_obj):
    app.dependency_overrides[get_sleeper_client] = lambda: client_obj


def _headers(account):
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def _regular_league(seed, db_session, *, year=2024, status=SeasonStatus.REGULAR):
    rs = ScoringRuleset(name="match", rules=MATCHING_RULESET)
    db_session.add(rs)
    db_session.flush()
    season = seed.season(year, status=status, scoring_ruleset_id=rs.id)
    league = seed.league(season, name="Alpha", sleeper_league_id="987654321")
    return season, league


def test_sync_now_success(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    _use_client(app, route_client(_sync_routes()))
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["league_id"] == league.id
    assert body["week"] == 5
    assert body["teams_synced"] == 2
    assert body["rosters_skipped"] == 0
    assert isinstance(body["mismatches"], int)


def test_sync_now_unknown_league_404(app, client, admin_headers):
    _use_client(app, route_client({"/state/nfl": NFL_STATE}))
    resp = client.post("/admin/leagues/999999/sync", headers=admin_headers)
    assert resp.status_code == 404


def test_sync_now_setup_season_409(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session, status=SeasonStatus.SETUP)
    _use_client(app, route_client(_sync_routes()))
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 409


def test_sync_now_non_current_season_409(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session, year=2023)
    _use_client(app, route_client(_sync_routes()))  # nfl_state.season == "2024"
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 409


def test_sync_now_sleeper_failure_502(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    _use_client(app, _failing_client())
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 502


def test_sync_now_league_admin_scope(app, client, db_session, seed, make_account):
    _season, league = _regular_league(seed, db_session)
    other_season = seed.season(2099, status=SeasonStatus.REGULAR)
    other = seed.league(other_season, name="Beta", sleeper_league_id="222")
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    _use_client(app, route_client(_sync_routes()))
    ok = client.post(f"/admin/leagues/{league.id}/sync", headers=_headers(la))
    assert ok.status_code == 200
    forbidden = client.post(f"/admin/leagues/{other.id}/sync", headers=_headers(la))
    assert forbidden.status_code == 403


def test_sync_now_requires_token(app, client, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    assert client.post(f"/admin/leagues/{league.id}/sync").status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_sync.py -v`
Expected: FAIL — 404 on `/admin/leagues/{id}/sync` (router not mounted).

- [ ] **Step 3: Add the response schema**

Append to `backend/app/api/admin/schemas.py` (`BaseModel` already imported):

```python
class SyncNowResponse(BaseModel):
    league_id: int
    week: int
    teams_synced: int
    rosters_skipped: int
    mismatches: int
```

- [ ] **Step 4: Implement the sync router**

Create `backend/app/api/admin/sync.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.admin.schemas import SyncNowResponse
from app.api.deps import get_sleeper_client, require_league_admin
from app.db import get_db
from app.models import League, SeasonStatus, Team, WeeklyScore
from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperError, SleeperNotFound
from app.sync.errors import SyncError
from app.sync.ruleset import resolve_ruleset
from app.sync.service import SyncService

router = APIRouter(prefix="/admin", tags=["admin"])

_SYNCABLE = {SeasonStatus.REGULAR, SeasonStatus.PLAYOFFS}


@router.post("/leagues/{league_id}/sync", response_model=SyncNowResponse)
async def sync_league_now(
    league_id: int,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
    _account=Depends(require_league_admin),
) -> SyncNowResponse:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = league.season
    if season.status not in _SYNCABLE:
        raise HTTPException(
            status_code=409,
            detail="League season is not syncable (use resync-setup during setup)",
        )
    try:
        nfl_state = await client.get_nfl_state()
        if season.year != int(nfl_state.season):
            # Not a Sleeper/Sync error — propagates past the except clauses below.
            raise HTTPException(
                status_code=409,
                detail="Manual sync only supports the current active season",
            )
        week = nfl_state.week
        ruleset = resolve_ruleset(db, season)
        result = await SyncService(client, db, season, ruleset).sync_week(
            league_id, week
        )
    except SleeperNotFound:
        raise HTTPException(status_code=422, detail="Sleeper data not found")
    except (SleeperError, SyncError):
        raise HTTPException(status_code=502, detail="Sleeper upstream error")

    db.commit()
    mismatches = db.execute(
        select(func.count())
        .select_from(WeeklyScore)
        .join(Team, WeeklyScore.team_id == Team.id)
        .where(
            Team.league_id == league_id,
            WeeklyScore.week == week,
            WeeklyScore.mismatch_flag.is_(True),
        )
    ).scalar_one()
    return SyncNowResponse(
        league_id=league_id,
        week=week,
        teams_synced=len(result.scored_team_ids),
        rosters_skipped=len(result.skipped_roster_ids),
        mismatches=mismatches,
    )
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import (with the other admin imports) and include it after `admin_mapping_router`:

```python
from app.api.admin.sync import router as admin_sync_router
```
```python
    app.include_router(admin_mapping_router)
    app.include_router(admin_sync_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_sync.py -v`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/sync.py app/api/admin/schemas.py app/main.py tests/api/admin/test_sync.py
git commit -m "feat: add synchronous per-league sync-now endpoint (super-admin + league-admin)"
```

---

### Task 2: League-Admin account management

**Files:**
- Create: `backend/app/api/admin/accounts.py`, `backend/tests/api/admin/test_accounts.py`
- Modify: `backend/app/api/admin/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.require_super_admin`; `app.api.security.hash_password`; `app.models.{Account, AccountRole, League, LeagueAdminGrant, Owner}`; fixtures `client`, `admin_headers`, `super_admin`, `make_account`, `seed`, `db_session`; `/auth/login` (API-1).
- Produces:
  - `admin.schemas.AccountCreate {email: str, password: str, owner_id: int | None = None}`
  - `admin.schemas.AccountPasswordReset {password: str}`
  - `admin.schemas.LeagueGrantRef {league_id: int, league_name: str}`
  - `admin.schemas.AccountAdminResponse {id: int, email: str, role: AccountRole, owner_id: int | None, grants: list[LeagueGrantRef]}`
  - `app.api.admin.accounts.router` — `APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])` with `POST /admin/accounts`, `GET /admin/accounts`, `PATCH /admin/accounts/{account_id}`, `DELETE /admin/accounts/{account_id}`; helpers `_grants_for`, `_account_resp` (reused by Task 3). Mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/admin/test_accounts.py`:

```python
from app.api.security import create_access_token
from app.models import Account, AccountRole, LeagueAdminGrant


def _la_headers(make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_create_account_requires_token(client):
    resp = client.post("/admin/accounts", json={"email": "x@e.com", "password": "pw"})
    assert resp.status_code == 401


def test_create_account_forbidden_for_league_admin(client, make_account):
    resp = client.post(
        "/admin/accounts",
        json={"email": "x@e.com", "password": "pw"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 403


def test_create_account_is_league_admin_and_hides_hash(client, admin_headers, db_session):
    resp = client.post(
        "/admin/accounts",
        json={"email": "new@e.com", "password": "pw"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "league_admin"
    assert body["grants"] == []
    assert "password_hash" not in body
    row = db_session.query(Account).filter_by(email="new@e.com").one()
    assert row.role is AccountRole.LEAGUE_ADMIN


def test_create_account_duplicate_email_409(client, admin_headers, make_account):
    make_account("dup@e.com", "pw")
    resp = client.post(
        "/admin/accounts",
        json={"email": "dup@e.com", "password": "pw"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_create_account_unknown_owner_422(client, admin_headers):
    resp = client.post(
        "/admin/accounts",
        json={"email": "o@e.com", "password": "pw", "owner_id": 999999},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_create_account_with_owner(client, admin_headers, seed):
    owner = seed.owner()
    resp = client.post(
        "/admin/accounts",
        json={"email": "own@e.com", "password": "pw", "owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["owner_id"] == owner.id


def test_list_accounts_includes_grants(client, admin_headers, db_session, seed, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    resp = client.get("/admin/accounts", headers=admin_headers)
    assert resp.status_code == 200
    by_email = {a["email"]: a for a in resp.json()}
    assert by_email["la@e.com"]["grants"] == [
        {"league_id": league.id, "league_name": "Alpha"}
    ]


def test_reset_password_then_login(client, admin_headers, make_account):
    acct = make_account("reset@e.com", "oldpw", role=AccountRole.LEAGUE_ADMIN)
    resp = client.patch(
        f"/admin/accounts/{acct.id}", json={"password": "newpw"}, headers=admin_headers
    )
    assert resp.status_code == 200
    assert client.post(
        "/auth/login", json={"email": "reset@e.com", "password": "newpw"}
    ).status_code == 200
    assert client.post(
        "/auth/login", json={"email": "reset@e.com", "password": "oldpw"}
    ).status_code == 401


def test_reset_password_unknown_404(client, admin_headers):
    resp = client.patch(
        "/admin/accounts/999999", json={"password": "x"}, headers=admin_headers
    )
    assert resp.status_code == 404


def test_delete_account_cascades_grants(client, admin_headers, db_session, seed, make_account):
    la = make_account("gone@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    la_id = la.id
    resp = client.delete(f"/admin/accounts/{la_id}", headers=admin_headers)
    assert resp.status_code == 204
    assert db_session.get(Account, la_id) is None
    assert db_session.query(LeagueAdminGrant).filter_by(account_id=la_id).count() == 0


def test_delete_unknown_account_404(client, admin_headers):
    assert client.delete("/admin/accounts/999999", headers=admin_headers).status_code == 404


def test_delete_last_super_admin_409(client, admin_headers, super_admin):
    # super_admin is the only SUPER_ADMIN (admin_headers is its token)
    resp = client.delete(f"/admin/accounts/{super_admin.id}", headers=admin_headers)
    assert resp.status_code == 409
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_accounts.py -v`
Expected: FAIL — 404 on `/admin/accounts` (router not mounted).

- [ ] **Step 3: Add the account schemas**

Append to `backend/app/api/admin/schemas.py` (`AccountRole` needs importing — add it to the existing `from app.models import ...` line, which currently imports `SeasonStatus`):

```python
class AccountCreate(BaseModel):
    email: str
    password: str
    owner_id: int | None = None


class AccountPasswordReset(BaseModel):
    password: str


class LeagueGrantRef(BaseModel):
    league_id: int
    league_name: str


class AccountAdminResponse(BaseModel):
    id: int
    email: str
    role: AccountRole
    owner_id: int | None
    grants: list[LeagueGrantRef]
```

- [ ] **Step 4: Implement the accounts router**

Create `backend/app/api/admin/accounts.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    AccountAdminResponse,
    AccountCreate,
    AccountPasswordReset,
    LeagueGrantRef,
)
from app.api.deps import require_super_admin
from app.api.security import hash_password
from app.db import get_db
from app.models import Account, AccountRole, League, LeagueAdminGrant, Owner

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _grants_for(db: Session, account_id: int) -> list[LeagueGrantRef]:
    rows = db.execute(
        select(League.id, League.name)
        .join(LeagueAdminGrant, LeagueAdminGrant.league_id == League.id)
        .where(LeagueAdminGrant.account_id == account_id)
        .order_by(League.id)
    ).all()
    return [LeagueGrantRef(league_id=lid, league_name=lname) for lid, lname in rows]


def _account_resp(db: Session, account: Account) -> AccountAdminResponse:
    return AccountAdminResponse(
        id=account.id,
        email=account.email,
        role=account.role,
        owner_id=account.owner_id,
        grants=_grants_for(db, account.id),
    )


@router.post("/accounts", response_model=AccountAdminResponse, status_code=201)
def create_account(
    body: AccountCreate, db: Session = Depends(get_db)
) -> AccountAdminResponse:
    if body.owner_id is not None and db.get(Owner, body.owner_id) is None:
        raise HTTPException(status_code=422, detail="Owner does not exist")
    existing = db.execute(
        select(Account).where(Account.email == body.email)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Account email already exists")
    account = Account(
        email=body.email,
        password_hash=hash_password(body.password),
        role=AccountRole.LEAGUE_ADMIN,
        owner_id=body.owner_id,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account email already exists")
    db.refresh(account)
    return _account_resp(db, account)


@router.get("/accounts", response_model=list[AccountAdminResponse])
def list_accounts(db: Session = Depends(get_db)) -> list[AccountAdminResponse]:
    accounts = db.execute(select(Account).order_by(Account.id)).scalars().all()
    return [_account_resp(db, a) for a in accounts]


@router.patch("/accounts/{account_id}", response_model=AccountAdminResponse)
def reset_password(
    account_id: int, body: AccountPasswordReset, db: Session = Depends(get_db)
) -> AccountAdminResponse:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    account.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(account)
    return _account_resp(db, account)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)) -> None:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.role is AccountRole.SUPER_ADMIN:
        others = db.execute(
            select(func.count())
            .select_from(Account)
            .where(Account.role == AccountRole.SUPER_ADMIN, Account.id != account_id)
        ).scalar_one()
        if others == 0:
            raise HTTPException(
                status_code=409, detail="Cannot delete the last super admin"
            )
    db.delete(account)
    db.commit()
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include it after `admin_sync_router`:

```python
from app.api.admin.accounts import router as admin_accounts_router
```
```python
    app.include_router(admin_sync_router)
    app.include_router(admin_accounts_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_accounts.py -v`
Expected: 12 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/accounts.py app/api/admin/schemas.py app/main.py tests/api/admin/test_accounts.py
git commit -m "feat: add super-admin League-Admin account management (create/list/reset/delete)"
```

---

### Task 3: League grant management + end-to-end

**Files:**
- Modify: `backend/app/api/admin/accounts.py` (append grant routes), `backend/app/api/admin/schemas.py`, `backend/tests/api/admin/test_accounts.py` (append grant + integration tests)

**Interfaces:**
- Consumes: everything from Task 2, plus Task 1's `POST /admin/leagues/{league_id}/sync` for the end-to-end test; `app.models.LeagueAdminGrant`.
- Produces: `admin.schemas.GrantCreate {league_id: int}`; on the existing `accounts.router`: `POST /admin/accounts/{account_id}/grants`, `DELETE /admin/accounts/{account_id}/grants/{league_id}`.

- [ ] **Step 1: Write the failing tests**

First, add these imports to the existing import block at the top of `backend/tests/api/admin/test_accounts.py` (alongside the Task 2 imports already there):

```python
from app.api.deps import get_sleeper_client
from app.models import ScoringRuleset, SeasonStatus
from tests.sync.conftest import load_fixture, route_client
```

Then append these tests to `backend/tests/api/admin/test_accounts.py`:

```python
def test_grant_league_success(client, admin_headers, db_session, seed, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    resp = client.post(
        f"/admin/accounts/{la.id}/grants",
        json={"league_id": league.id},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json() == {"league_id": league.id, "league_name": "Alpha"}
    assert (
        db_session.query(LeagueAdminGrant)
        .filter_by(account_id=la.id, league_id=league.id)
        .count()
        == 1
    )


def test_grant_unknown_account_404(client, admin_headers, seed):
    season = seed.season(2024)
    league = seed.league(season, name="A")
    resp = client.post(
        "/admin/accounts/999999/grants",
        json={"league_id": league.id},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_grant_unknown_league_404(client, admin_headers, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    resp = client.post(
        f"/admin/accounts/{la.id}/grants",
        json={"league_id": 999999},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_grant_super_admin_account_422(client, admin_headers, make_account, seed):
    sa = make_account("sa2@e.com", "pw", role=AccountRole.SUPER_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="A")
    resp = client.post(
        f"/admin/accounts/{sa.id}/grants",
        json={"league_id": league.id},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_grant_duplicate_409(client, admin_headers, db_session, seed, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="A")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    resp = client.post(
        f"/admin/accounts/{la.id}/grants",
        json={"league_id": league.id},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_revoke_grant(client, admin_headers, db_session, seed, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="A")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    resp = client.delete(
        f"/admin/accounts/{la.id}/grants/{league.id}", headers=admin_headers
    )
    assert resp.status_code == 204
    assert (
        db_session.query(LeagueAdminGrant)
        .filter_by(account_id=la.id, league_id=league.id)
        .count()
        == 0
    )


def test_revoke_unknown_grant_404(client, admin_headers, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    resp = client.delete(
        f"/admin/accounts/{la.id}/grants/999999", headers=admin_headers
    )
    assert resp.status_code == 404


def test_granted_league_admin_can_sync(app, client, admin_headers, db_session, seed, make_account):
    rs = ScoringRuleset(name="match", rules={"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1})
    db_session.add(rs)
    db_session.flush()
    season = seed.season(2024, status=SeasonStatus.REGULAR, scoring_ruleset_id=rs.id)
    league = seed.league(season, name="Alpha", sleeper_league_id="987654321")
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)

    granted = client.post(
        f"/admin/accounts/{la.id}/grants",
        json={"league_id": league.id},
        headers=admin_headers,
    )
    assert granted.status_code == 201

    app.dependency_overrides[get_sleeper_client] = lambda: route_client(
        {
            "/state/nfl": {"season": "2024", "week": 5, "season_type": "regular"},
            "/league/987654321/matchups/5": load_fixture("matchups.json"),
            "/league/987654321/rosters": load_fixture("rosters.json"),
            "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
        }
    )
    la_headers = {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=la_headers)
    assert resp.status_code == 200
    assert resp.json()["teams_synced"] == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_accounts.py -k "grant or revoke or granted" -v`
Expected: FAIL — 404/405 on `/admin/accounts/{id}/grants` (routes not defined).

- [ ] **Step 3: Add the grant schema**

Append to `backend/app/api/admin/schemas.py`:

```python
class GrantCreate(BaseModel):
    league_id: int
```

- [ ] **Step 4: Implement the grant routes**

Append to `backend/app/api/admin/accounts.py` (add `GrantCreate` to the existing `from app.api.admin.schemas import (...)` block):

```python
@router.post(
    "/accounts/{account_id}/grants",
    response_model=LeagueGrantRef,
    status_code=201,
)
def grant_league(
    account_id: int, body: GrantCreate, db: Session = Depends(get_db)
) -> LeagueGrantRef:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.role is not AccountRole.LEAGUE_ADMIN:
        raise HTTPException(
            status_code=422, detail="Grants apply only to league admins"
        )
    league = db.get(League, body.league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    db.add(LeagueAdminGrant(account_id=account_id, league_id=body.league_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Grant already exists")
    return LeagueGrantRef(league_id=league.id, league_name=league.name)


@router.delete("/accounts/{account_id}/grants/{league_id}", status_code=204)
def revoke_league(
    account_id: int, league_id: int, db: Session = Depends(get_db)
) -> None:
    grant = db.execute(
        select(LeagueAdminGrant).where(
            LeagueAdminGrant.account_id == account_id,
            LeagueAdminGrant.league_id == league_id,
        )
    ).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="Grant not found")
    db.delete(grant)
    db.commit()
```

- [ ] **Step 5: Run the grant + integration tests**

Run: `uv run pytest tests/api/admin/test_accounts.py -v`
Expected: all pass (Task 2's 12 + 8 new grant/integration = 20).

- [ ] **Step 6: Run the full suite**

Run: `uv run pytest`
Expected: all green (previous total + 7 sync + 20 accounts/grants), only the known baseline warnings (PyJWT `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/accounts.py app/api/admin/schemas.py tests/api/admin/test_accounts.py
git commit -m "feat: add account-nested league grant/revoke + end-to-end granted-LA sync"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green, only the known baseline warnings.
- Manual smoke (optional, needs dev DB + a real Sleeper league in a REGULAR season): create a super admin (API-1 CLI), `POST /admin/accounts` to make a League Admin, `POST /admin/accounts/{id}/grants` for a league, log in as that League Admin (`POST /auth/login`), and `POST /admin/leagues/{league_id}/sync` — confirm it syncs their granted league (200 with counts) but returns 403 for a league they weren't granted. Confirm account responses never include `password_hash`.
```
