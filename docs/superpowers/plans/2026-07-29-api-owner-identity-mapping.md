# Admin: Owner Identity & Mapping (API-3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin API to manage platform Owner records and map each synced Sleeper roster (`team`) to an Owner, populating the owner-history spine that API-2 profiles read.

**Architecture:** Two new routers under `/admin` — an Owner resource (`owners.py`, per-route auth: any admin creates/searches/views, super-admin edits) and a league-scoped mapping router (`mapping.py`, guarded by a reshaped `require_league_admin`). A one-column model change (`Team.sleeper_display_name`) plus a small sync-service tweak persist the Sleeper display name so the mapping worksheet is human-readable.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic, httpx (SleeperClient in sync tests), pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-api-owner-identity-mapping-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- Postgres REQUIRED for tests — test DB `insight2redraft_test`. The test suite builds its schema with `Base.metadata.create_all` (from `tests/conftest.py`), **not** Alembic — so a model change is what turns tests green; the Alembic migration keeps the deployed schema in parity.
- **Write endpoints must `db.commit()`** — `get_db` does not commit.
- **Error mapping:** no/invalid token → 401; wrong role or league not granted → 403; unknown league/team in path (or team-not-in-named-league) → 404; assign body references a non-existent `owner_id`, or malformed body → 422; duplicate Owner email → 409.
- **Any `Account` is an admin** (roles are only `super_admin` / `league_admin`), so "any admin" = a valid bearer token (`Depends(get_current_account)`).
- `diffs` and other admin-only detail never appear in public (API-2) responses.
- No new dependencies. No pagination. No unassign (owner_id is required on assign; re-assign is supported).
- Known warning baseline in test output: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/api/admin/owners.py`, `app/api/admin/mapping.py`, one Alembic revision under `alembic/versions/`, `tests/api/admin/test_owners.py`, `tests/api/admin/test_mapping.py`
- Modify: `app/models/competition.py` (add `Team.sleeper_display_name`), `app/sync/service.py` (`_upsert_teams` users join), `app/api/admin/schemas.py` (owner + mapping schemas), `app/api/deps.py` (reshape `require_league_admin`), `app/main.py` (mount two routers), `tests/sync/test_service.py` (display-name tests), `tests/api/test_deps.py` (reshape the direct-call tests + add a route test)

Reused: `tests/api/conftest.py` (`app`, `client`, `make_account`); `tests/api/admin/conftest.py` (`super_admin`, `admin_headers`); `tests/conftest.py` (`db_session`, `seed`); `tests/sync/conftest.py` (`route_client`, `load_fixture`, `league_routes`); `tests/sync/test_service.py` helpers `_season`, `_synced_league`; recorded fixtures `tests/sleeper/fixtures/{users,rosters,league}.json` (roster 1 → user "100"/display "commish", roster 2 → user "200"/display "member").

---

### Task 1: Persist Sleeper display name on `team` (model + sync + migration)

**Files:**
- Modify: `backend/app/models/competition.py`, `backend/app/sync/service.py`
- Create: one Alembic revision under `backend/alembic/versions/`
- Test: `backend/tests/sync/test_service.py`

**Interfaces:**
- Produces: `Team.sleeper_display_name: Mapped[str | None]` (String(100)); `SyncService._upsert_teams(self, league: League, rosters: list[SleeperRoster], users: list[SleeperUser] | None = None) -> list[Team]` — sets each team's `sleeper_display_name` from the `users` payload when provided, preserves it when `users is None`.
- Consumes: `SleeperUser.display_name` / `SleeperUser.user_id`, `SleeperRoster.owner_id` (all already present).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/sync/test_service.py` (after the existing setup tests; `_season`, `_synced_league`, `league_routes`, `MATCHING_RULESET`, `route_client`, and `Team` are already imported/defined in this module):

```python
async def test_sync_league_setup_sets_display_name(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    await service.sync_league_setup("987654321")

    team = db_session.query(Team).filter_by(sleeper_roster_id=1).one()
    assert team.sleeper_display_name == "commish"


async def test_sync_week_preserves_display_name(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    await service.sync_week(league_id, 5)  # sync_week does not fetch users

    team = db_session.query(Team).filter_by(sleeper_roster_id=1).one()
    assert team.sleeper_display_name == "commish"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/sync/test_service.py::test_sync_league_setup_sets_display_name -v`
Expected: FAIL — `AttributeError: 'Team' object has no attribute 'sleeper_display_name'` (or a mapper error).

- [ ] **Step 3: Add the model column**

In `backend/app/models/competition.py`, add to `Team` (right after the `sleeper_user_id` column, keeping the Sleeper-derived fields together):

```python
    sleeper_display_name: Mapped[str | None] = mapped_column(String(100))
```

- [ ] **Step 4: Thread `users` through `_upsert_teams`**

In `backend/app/sync/service.py`, add `SleeperUser` to the existing sleeper-models import (it is currently `from app.sleeper.models import SleeperMatchup, SleeperRoster`):

```python
from app.sleeper.models import SleeperMatchup, SleeperRoster, SleeperUser
```

Change the `sync_league_setup` call site to pass the users it already fetched (the line is currently `self._upsert_teams(league, rosters)`):

```python
        self._session.flush()
        self._upsert_teams(league, rosters, users)
        self._session.flush()
```

Replace the entire `_upsert_teams` method with this complete version (note the added `users` parameter, the `display_by_user` map, the one new assignment, and the unchanged `teams.append` / `return teams` tail):

```python
    def _upsert_teams(
        self,
        league: League,
        rosters: list[SleeperRoster],
        users: list[SleeperUser] | None = None,
    ) -> list[Team]:
        display_by_user = (
            {u.user_id: u.display_name for u in users} if users is not None else None
        )
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
            if display_by_user is not None:
                team.sleeper_display_name = display_by_user.get(roster.owner_id)
            team.wins = roster.settings.wins
            team.losses = roster.settings.losses
            team.ties = roster.settings.ties
            team.points_for = Decimal(str(roster.points_for))
            team.points_against = Decimal(str(roster.points_against))
            teams.append(team)
        return teams
```

The `sync_week` call site stays `self._upsert_teams(league, rosters)` (no `users`), so weekly sync preserves the name.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/sync/test_service.py -v`
Expected: all pass, including the two new tests. No new warnings.

- [ ] **Step 6: Create the Alembic migration**

Generate a stamped revision file (this writes the correct `down_revision` head and a fresh id; it does not need a DB connection):

Run: `uv run alembic revision -m "add team sleeper_display_name"`

Open the new file in `backend/alembic/versions/` and set the two functions:

```python
def upgrade() -> None:
    op.add_column(
        "team",
        sa.Column("sleeper_display_name", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("team", "sleeper_display_name")
```

Confirm `down_revision = "198fa9815fce"` (the current head). Leave `revision` as generated.

- [ ] **Step 7: Commit**

```bash
git add app/models/competition.py app/sync/service.py alembic/versions/ tests/sync/test_service.py
git commit -m "feat: persist Sleeper display name on team for owner mapping"
```

---

### Task 2: Owner schemas + `/admin/owners` CRUD-lite + auth

**Files:**
- Modify: `backend/app/api/admin/schemas.py`, `backend/app/main.py`
- Create: `backend/app/api/admin/owners.py`, `backend/tests/api/admin/test_owners.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.{get_current_account, require_super_admin}`; `app.models.Owner`; fixtures `client`, `admin_headers`, `make_account`, `seed`, `db_session`.
- Produces:
  - `admin.schemas.OwnerCreate {first_name, last_name, email: str|None=None, display_name: str|None=None, avatar_url: str|None=None, notes: str|None=None}`
  - `admin.schemas.OwnerUpdate` — all six fields `| None = None`
  - `admin.schemas.OwnerSleeperLinkRef {sleeper_user_id: str, season: int, sleeper_display_name: str|None}` (`from_attributes`)
  - `admin.schemas.OwnerAdminResponse {id, first_name, last_name, email, display_name, avatar_url, notes}` (`from_attributes`)
  - `admin.schemas.OwnerAdminDetail(OwnerAdminResponse) {sleeper_links: list[OwnerSleeperLinkRef]}`
  - `app.api.admin.owners.router` — `APIRouter(prefix="/admin", tags=["admin"])` with `POST /admin/owners`, `GET /admin/owners`, `GET /admin/owners/{owner_id}`, `PATCH /admin/owners/{owner_id}`, mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/admin/test_owners.py`:

```python
from app.api.security import create_access_token
from app.models import AccountRole, Owner


def _la_headers(make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_create_owner_requires_token(client):
    resp = client.post("/admin/owners", json={"first_name": "A", "last_name": "B"})
    assert resp.status_code == 401


def test_create_owner_succeeds(client, admin_headers, db_session):
    resp = client.post(
        "/admin/owners",
        json={"first_name": "Jack", "last_name": "Altiere", "email": "j@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["first_name"] == "Jack"
    assert db_session.query(Owner).filter_by(email="j@example.com").count() == 1


def test_create_owner_allowed_for_any_admin(client, make_account):
    resp = client.post(
        "/admin/owners",
        json={"first_name": "L", "last_name": "A"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 201


def test_create_owner_duplicate_email_409(client, admin_headers, seed):
    seed.owner(email="dup@example.com")
    resp = client.post(
        "/admin/owners",
        json={"first_name": "X", "last_name": "Y", "email": "dup@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_list_owners_search_filters_by_q(client, admin_headers, seed):
    seed.owner(first_name="Alice", last_name="Smith")
    seed.owner(first_name="Bob", last_name="Jones")
    resp = client.get("/admin/owners", params={"q": "ali"}, headers=admin_headers)
    assert resp.status_code == 200
    assert {o["first_name"] for o in resp.json()} == {"Alice"}


def test_get_owner_includes_links_and_404(client, admin_headers, seed):
    owner = seed.owner()
    ok = client.get(f"/admin/owners/{owner.id}", headers=admin_headers)
    assert ok.status_code == 200
    assert ok.json()["sleeper_links"] == []
    assert client.get("/admin/owners/999999", headers=admin_headers).status_code == 404


def test_patch_owner_updates_fields(client, admin_headers, seed):
    owner = seed.owner(first_name="Old")
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"first_name": "New", "notes": "vip"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["first_name"] == "New"


def test_patch_owner_forbidden_for_league_admin(client, make_account, seed):
    owner = seed.owner()
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"first_name": "Nope"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 403


def test_patch_owner_duplicate_email_409(client, admin_headers, seed):
    seed.owner(email="taken@example.com")
    owner = seed.owner(first_name="Movable")
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"email": "taken@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_patch_unknown_owner_404(client, admin_headers):
    resp = client.patch(
        "/admin/owners/999999", json={"first_name": "X"}, headers=admin_headers
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_owners.py -v`
Expected: FAIL — 404 on `/admin/owners` (router not mounted).

- [ ] **Step 3: Add the owner schemas**

Append to `backend/app/api/admin/schemas.py` (`BaseModel`, `ConfigDict`, `Field` are already imported):

```python
class OwnerCreate(BaseModel):
    first_name: str
    last_name: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    notes: str | None = None


class OwnerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    notes: str | None = None


class OwnerSleeperLinkRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sleeper_user_id: str
    season: int
    sleeper_display_name: str | None


class OwnerAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    notes: str | None


class OwnerAdminDetail(OwnerAdminResponse):
    sleeper_links: list[OwnerSleeperLinkRef]
```

- [ ] **Step 4: Implement the owners router**

Create `backend/app/api/admin/owners.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    OwnerAdminDetail,
    OwnerAdminResponse,
    OwnerCreate,
    OwnerUpdate,
)
from app.api.deps import get_current_account, require_super_admin
from app.db import get_db
from app.models import Owner

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/owners", response_model=OwnerAdminResponse, status_code=201)
def create_owner(
    body: OwnerCreate,
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> Owner:
    if body.email is not None:
        existing = db.execute(
            select(Owner).where(Owner.email == body.email)
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Owner email already exists")
    owner = Owner(**body.model_dump())
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return owner


@router.get("/owners", response_model=list[OwnerAdminResponse])
def list_owners(
    q: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> list[Owner]:
    stmt = select(Owner)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Owner.first_name.ilike(pattern),
                Owner.last_name.ilike(pattern),
                Owner.display_name.ilike(pattern),
                Owner.email.ilike(pattern),
            )
        )
    stmt = stmt.order_by(Owner.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


@router.get("/owners/{owner_id}", response_model=OwnerAdminDetail)
def get_owner(
    owner_id: int,
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> Owner:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    return owner


@router.patch("/owners/{owner_id}", response_model=OwnerAdminResponse)
def update_owner(
    owner_id: int,
    body: OwnerUpdate,
    db: Session = Depends(get_db),
    _account=Depends(require_super_admin),
) -> Owner:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    data = body.model_dump(exclude_unset=True)
    new_email = data.get("email")
    if new_email is not None and new_email != owner.email:
        clash = db.execute(
            select(Owner).where(Owner.email == new_email)
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Owner email already exists")
    for field, value in data.items():
        setattr(owner, field, value)
    db.commit()
    db.refresh(owner)
    return owner
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import (with the other admin imports) and include it after `admin_leagues_router`:

```python
from app.api.admin.owners import router as admin_owners_router
```
```python
    app.include_router(admin_leagues_router)
    app.include_router(admin_owners_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_owners.py -v`
Expected: 10 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/owners.py app/api/admin/schemas.py app/main.py tests/api/admin/test_owners.py
git commit -m "feat: add admin owner CRUD-lite endpoints (create/search/view/edit)"
```

---

### Task 3: `require_league_admin` reshape + league mapping (worksheet + assign)

**Files:**
- Modify: `backend/app/api/deps.py`, `backend/app/api/admin/schemas.py`, `backend/app/main.py`, `backend/tests/api/test_deps.py`
- Create: `backend/app/api/admin/mapping.py`, `backend/tests/api/admin/test_mapping.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.require_league_admin` (reshaped); `app.models.{League, Owner, OwnerSleeperLink, Team}`; fixtures `client`, `admin_headers`, `make_account`, `seed`, `db_session`.
- Produces:
  - `app.api.deps.require_league_admin(league_id: int = Path(...), account: Account = Depends(get_current_account), db: Session = Depends(get_db)) -> Account` — a direct dependency (no longer a factory), consumed as bare `Depends(require_league_admin)`.
  - `admin.schemas.OwnerRef {id, first_name, last_name, display_name}` (`from_attributes`)
  - `admin.schemas.TeamOwnerAssign {owner_id: int}`
  - `admin.schemas.TeamMappingRow {team_id, sleeper_roster_id, sleeper_user_id: str|None, sleeper_display_name: str|None, owner: OwnerRef|None}`
  - `app.api.admin.mapping.router` — `APIRouter(prefix="/admin", tags=["admin"])` with `GET /admin/leagues/{league_id}/teams`, `PATCH /admin/leagues/{league_id}/teams/{team_id}`, mounted in `create_app()`.

- [ ] **Step 1: Reshape the direct-call tests and add a route test**

Replace the three `require_league_admin` direct-call tests at the bottom of `backend/tests/api/test_deps.py` (currently calling `require_league_admin(league.id)` then `dep(account=..., db=...)`) with the new call form, and add a route-enforcement test. The final section of the file becomes:

```python
# require_league_admin — direct calls (reshaped to path-param dependency)

def test_league_admin_with_grant_passes(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=admin.id, league_id=league.id))
    db_session.flush()
    assert require_league_admin(league_id=league.id, account=admin, db=db_session) is admin


def test_league_admin_without_grant_rejected_403(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    with pytest.raises(HTTPException) as exc:
        require_league_admin(league_id=league.id, account=admin, db=db_session)
    assert exc.value.status_code == 403


def test_super_admin_passes_any_league_without_grant(db_session, make_account, league):
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    assert require_league_admin(league_id=league.id, account=root, db=db_session) is root


# require_league_admin — wired through a real {league_id} route end-to-end

def test_require_league_admin_route_enforcement(app, db_session, make_account, league):
    @app.get("/_test/leagues/{league_id}/guarded")
    def guarded(
        league_id: int, account: Account = Depends(require_league_admin)
    ) -> dict[str, int]:
        return {"id": account.id}

    client = TestClient(app)
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    granted = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=granted.id, league_id=league.id))
    ungranted = make_account("other@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.flush()

    assert client.get(
        f"/_test/leagues/{league.id}/guarded", headers=_auth_header(root)
    ).status_code == 200
    assert client.get(
        f"/_test/leagues/{league.id}/guarded", headers=_auth_header(granted)
    ).status_code == 200
    assert client.get(
        f"/_test/leagues/{league.id}/guarded", headers=_auth_header(ungranted)
    ).status_code == 403
    assert client.get(f"/_test/leagues/{league.id}/guarded").status_code == 401
```

- [ ] **Step 2: Run the reshaped tests to verify they fail**

Run: `uv run pytest tests/api/test_deps.py -v`
Expected: FAIL — the direct-call tests raise `TypeError` (old factory took a positional `league_id` and returned a callable), and the route test fails because `require_league_admin` isn't yet a usable path dependency.

- [ ] **Step 3: Reshape `require_league_admin`**

In `backend/app/api/deps.py`: change the imports — drop `Callable` (now unused) and add `Path`:

```python
from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, Path
```

Replace the whole `require_league_admin` factory with the direct dependency:

```python
def require_league_admin(
    league_id: int = Path(...),
    account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
) -> Account:
    if account.role is AccountRole.SUPER_ADMIN:
        return account
    grant = db.execute(
        select(LeagueAdminGrant).where(
            LeagueAdminGrant.account_id == account.id,
            LeagueAdminGrant.league_id == league_id,
        )
    ).scalar_one_or_none()
    if grant is None:
        raise _forbidden()
    return account
```

- [ ] **Step 4: Run the deps tests to verify they pass**

Run: `uv run pytest tests/api/test_deps.py -v`
Expected: all pass (the two `require_super_admin` tests, the three reshaped league-admin tests, both route-enforcement tests).

- [ ] **Step 5: Write the failing mapping tests**

Create `backend/tests/api/admin/test_mapping.py`:

```python
from app.api.security import create_access_token
from app.models import AccountRole, LeagueAdminGrant, OwnerSleeperLink


def _headers(account):
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def _league_with_team(seed, *, sleeper_user_id="100", display="commish"):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    team = seed.team(
        league, sleeper_user_id=sleeper_user_id, sleeper_display_name=display
    )
    return season, league, team


def test_worksheet_lists_rows(client, admin_headers, seed):
    _season, league, _team = _league_with_team(seed)
    resp = client.get(f"/admin/leagues/{league.id}/teams", headers=admin_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["sleeper_display_name"] == "commish"
    assert rows[0]["owner"] is None


def test_worksheet_unknown_league_404(client, admin_headers):
    assert client.get("/admin/leagues/999999/teams", headers=admin_headers).status_code == 404


def test_assign_sets_owner_and_link(client, admin_headers, db_session, seed):
    _season, league, team = _league_with_team(seed)
    owner = seed.owner(first_name="Jack")
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["owner"]["id"] == owner.id
    link = db_session.query(OwnerSleeperLink).filter_by(
        sleeper_user_id="100", season=2024
    ).one()
    assert link.owner_id == owner.id
    assert link.sleeper_display_name == "commish"


def test_reassign_updates_same_link(client, admin_headers, db_session, seed):
    _season, league, team = _league_with_team(seed)
    first = seed.owner(first_name="First")
    second = seed.owner(first_name="Second")
    client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": first.id}, headers=admin_headers,
    )
    client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": second.id}, headers=admin_headers,
    )
    links = db_session.query(OwnerSleeperLink).filter_by(
        sleeper_user_id="100", season=2024
    ).all()
    assert len(links) == 1
    assert links[0].owner_id == second.id


def test_assign_unknown_owner_422(client, admin_headers, seed):
    _season, league, team = _league_with_team(seed)
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": 999999},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_assign_team_not_in_league_404(client, admin_headers, seed):
    season, _league, team = _league_with_team(seed)
    other = seed.league(season, name="Beta")
    resp = client.patch(
        f"/admin/leagues/{other.id}/teams/{team.id}",
        json={"owner_id": 1},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_assign_null_sleeper_user_skips_link(client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, sleeper_user_id=None, sleeper_display_name=None)
    owner = seed.owner()
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["owner"]["id"] == owner.id
    assert db_session.query(OwnerSleeperLink).count() == 0


def test_league_admin_maps_own_league_only(client, db_session, seed, make_account):
    season, league, team = _league_with_team(seed)
    other = seed.league(season, name="Beta")
    other_team = seed.team(other, sleeper_user_id="200", sleeper_display_name="member")
    owner = seed.owner()
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()

    ok = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id}, headers=_headers(la),
    )
    assert ok.status_code == 200

    forbidden = client.patch(
        f"/admin/leagues/{other.id}/teams/{other_team.id}",
        json={"owner_id": owner.id}, headers=_headers(la),
    )
    assert forbidden.status_code == 403


def test_mapping_requires_token(client, seed):
    _season, league, _team = _league_with_team(seed)
    assert client.get(f"/admin/leagues/{league.id}/teams").status_code == 401
```

- [ ] **Step 6: Run mapping tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_mapping.py -v`
Expected: FAIL — 404 on `/admin/leagues/{id}/teams` (router not mounted).

- [ ] **Step 7: Add the mapping schemas**

Append to `backend/app/api/admin/schemas.py`:

```python
class OwnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    display_name: str | None


class TeamOwnerAssign(BaseModel):
    owner_id: int


class TeamMappingRow(BaseModel):
    team_id: int
    sleeper_roster_id: int
    sleeper_user_id: str | None
    sleeper_display_name: str | None
    owner: OwnerRef | None
```

- [ ] **Step 8: Implement the mapping router**

Create `backend/app/api/admin/mapping.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import OwnerRef, TeamMappingRow, TeamOwnerAssign
from app.api.deps import require_league_admin
from app.db import get_db
from app.models import League, Owner, OwnerSleeperLink, Team

router = APIRouter(prefix="/admin", tags=["admin"])


def _row(db: Session, team: Team) -> TeamMappingRow:
    owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
    return TeamMappingRow(
        team_id=team.id,
        sleeper_roster_id=team.sleeper_roster_id,
        sleeper_user_id=team.sleeper_user_id,
        sleeper_display_name=team.sleeper_display_name,
        owner=OwnerRef.model_validate(owner) if owner is not None else None,
    )


@router.get("/leagues/{league_id}/teams", response_model=list[TeamMappingRow])
def list_team_mappings(
    league_id: int,
    db: Session = Depends(get_db),
    _account=Depends(require_league_admin),
) -> list[TeamMappingRow]:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    teams = (
        db.execute(
            select(Team)
            .where(Team.league_id == league_id)
            .order_by(Team.sleeper_roster_id)
        )
        .scalars()
        .all()
    )
    return [_row(db, t) for t in teams]


@router.patch(
    "/leagues/{league_id}/teams/{team_id}", response_model=TeamMappingRow
)
def assign_team_owner(
    league_id: int,
    team_id: int,
    body: TeamOwnerAssign,
    db: Session = Depends(get_db),
    _account=Depends(require_league_admin),
) -> TeamMappingRow:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    team = db.get(Team, team_id)
    if team is None or team.league_id != league_id:
        raise HTTPException(status_code=404, detail="Team not found in league")
    owner = db.get(Owner, body.owner_id)
    if owner is None:
        raise HTTPException(status_code=422, detail="Owner does not exist")

    team.owner_id = owner.id
    if team.sleeper_user_id is not None:
        link = db.execute(
            select(OwnerSleeperLink).where(
                OwnerSleeperLink.sleeper_user_id == team.sleeper_user_id,
                OwnerSleeperLink.season == league.season.year,
            )
        ).scalar_one_or_none()
        if link is None:
            link = OwnerSleeperLink(
                sleeper_user_id=team.sleeper_user_id,
                season=league.season.year,
            )
            db.add(link)
        link.owner_id = owner.id
        link.sleeper_display_name = team.sleeper_display_name

    db.commit()
    db.refresh(team)
    return _row(db, team)
```

- [ ] **Step 9: Wire the router into the app**

In `backend/app/main.py`, add the import and include it after `admin_owners_router`:

```python
from app.api.admin.mapping import router as admin_mapping_router
```
```python
    app.include_router(admin_owners_router)
    app.include_router(admin_mapping_router)
```

- [ ] **Step 10: Run the mapping tests**

Run: `uv run pytest tests/api/admin/test_mapping.py -v`
Expected: 9 passed.

- [ ] **Step 11: Run the full suite**

Run: `uv run pytest`
Expected: all green (previous baseline + 2 sync + 10 owners + 9 mapping + 1 new deps route test; the three reshaped deps tests keep passing). Only the known baseline warnings (PyJWT `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

- [ ] **Step 12: Commit**

```bash
git add app/api/deps.py app/api/admin/mapping.py app/api/admin/schemas.py app/main.py tests/api/test_deps.py tests/api/admin/test_mapping.py
git commit -m "feat: add league-scoped owner mapping + reshape require_league_admin"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green, only the known baseline warnings.
- `uv run alembic upgrade head` against the dev DB applies the `team.sleeper_display_name` column cleanly (manual; the test suite uses `create_all`, so this checks deploy-path parity).
- Manual smoke (optional, needs dev DB): create a super admin (API-1 CLI), enter a league (API-3a), `GET /admin/leagues/{id}/teams` shows each roster's `sleeper_display_name`, `POST /admin/owners` then `PATCH /admin/leagues/{id}/teams/{team_id}` with the new `owner_id`, and confirm the API-2 `GET /owners/{owner_id}` profile now reflects that team's season record. Confirm no admin-only detail leaks into public responses.
```
