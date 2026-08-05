# Bracket Generation + Approval + Public Read (API-4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin can generate a season's super-bracket (seeded + round-1 matchups) via the 4a engine, review the PENDING draft and approve it to ACTIVE, and the public can read an ACTIVE/COMPLETE bracket.

**Architecture:** A DB-bound `generate_bracket` service (`app/bracket/generation.py`) composes the pure 4a engine with the existing bracket tables. A super-admin router (`app/api/admin/bracket.py`) generates/approves/reads; a public router (`app/api/bracket.py`) exposes ACTIVE/COMPLETE brackets grouped into rounds. No model changes, no migration.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-bracket-generation-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`. Postgres REQUIRED (test DB `insight2redraft_test`).
- **Write endpoints must `db.commit()`.** The `generate_bracket` service flushes but does NOT commit — the endpoint owns the transaction.
- **Error mapping:** 401 no token / 403 non-super-admin (router-level gate); generate 404 unknown season, 409 season not PLAYOFFS or existing ACTIVE/COMPLETE bracket, 422 too-few-teams / no-playoff-weeks; approve 404 no bracket, 409 not PENDING; admin read 404 no bracket; public read 404 when absent OR PENDING.
- **Generation creates round 1 only**; game scores/winner are null (byes get `winner_team_id` + `is_finalized=True`). `qualified_via` is always `AUTO`.
- **Public read never exposes a PENDING bracket** and carries no admin-only detail.
- The pure engine `app/bracket/engine.py` is NOT modified.
- No new dependencies. No pagination. Known warning baseline: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/bracket/generation.py`, `app/api/admin/bracket.py`, `app/api/bracket.py`, `tests/bracket/test_generation.py`, `tests/api/admin/test_bracket.py`, `tests/api/test_bracket.py`
- Modify: `app/api/admin/schemas.py`, `app/api/public_schemas.py`, `app/main.py`

Grounding (already in the codebase):
- Engine (`app/bracket/engine.py`, pure): `seed_field(standings: Iterable[TeamStanding], field_per_league) -> list[SeededTeam{team_id, seed}]`; `generate_round(remaining: Iterable[RemainingTeam]) -> RoundPlan{games: list[RoundGame{high, low}], byes: list[int]}` (requires N>=2); `TeamStanding{team_id, league_id, wins, losses, ties, points_for: Decimal}`, `RemainingTeam{team_id, seed}`.
- Models: `Bracket(season_id unique, size, status: BracketStatus PENDING|ACTIVE|COMPLETE)`; `BracketSeed(bracket_id, team_id, seed, qualified_via: QualifiedVia AUTO|WILDCARD)`; `BracketMatchup(bracket_id, round, nfl_week, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, is_finalized, bye)` — all FKs from `bracket` cascade on delete. `Team{league_id, owner_id, wins, losses, ties, points_for}` + `.league` relationship (`League.name`); no `.owner` relationship (use `db.get(Owner, team.owner_id)`). `Season{status, playoff_field_per_league, nfl_playoff_weeks, .leagues}`.
- Fixtures: `seed.season(year, status=..., playoff_field_per_league=..., nfl_playoff_weeks=...)`, `seed.league(season, name=...)`, `seed.team(league, owner=None, wins=, losses=, ties=, points_for=, ...)`, `seed.owner(first_name=, last_name=, ...)`; `client`, `admin_headers`, `make_account`, `db_session`.
- `app/api/public_schemas.py` already defines `OwnerRef{id, first_name, last_name, display_name, avatar_url}` (`from_attributes`). Admin routers use `dependencies=[Depends(require_super_admin)]`.

---

### Task 1: `generate_bracket` service

**Files:**
- Create: `backend/app/bracket/generation.py`, `backend/tests/bracket/test_generation.py`

**Interfaces:**
- Consumes: `app.bracket.engine.{TeamStanding, RemainingTeam, seed_field, generate_round}`; `app.models.{Bracket, BracketMatchup, BracketSeed, BracketStatus, QualifiedVia, League, Season, Team}`.
- Produces: `app.bracket.generation.BracketGenerationError` (Exception); `generate_bracket(session: Session, season: Season) -> Bracket` — seeds from final standings, creates a PENDING `Bracket` + `BracketSeed` rows + round-1 `BracketMatchup` rows (games high-vs-low; byes auto-advanced). Flushes, does not commit. Raises `BracketGenerationError` for `< 2` qualifiers or empty `nfl_playoff_weeks`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/bracket/test_generation.py`:

```python
from decimal import Decimal

import pytest

from app.bracket.generation import BracketGenerationError, generate_bracket
from app.models import BracketMatchup, BracketSeed, BracketStatus, QualifiedVia, SeasonStatus


def _season_4(seed):
    season = seed.season(
        2024, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))
    return season


def test_generate_bracket_pending_bracket_and_seeds(db_session, seed):
    season = _season_4(seed)
    bracket = generate_bracket(db_session, season)
    db_session.flush()
    assert bracket.status is BracketStatus.PENDING
    assert bracket.size == 4
    seeds = (
        db_session.query(BracketSeed)
        .filter_by(bracket_id=bracket.id).order_by(BracketSeed.seed).all()
    )
    assert [s.seed for s in seeds] == [1, 2, 3, 4]
    assert all(s.qualified_via is QualifiedVia.AUTO for s in seeds)


def test_generate_bracket_round_one_high_vs_low(db_session, seed):
    season = _season_4(seed)
    bracket = generate_bracket(db_session, season)
    seed_by_team = {
        s.team_id: s.seed
        for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)
    }
    games = (
        db_session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id, bye=False).all()
    )
    assert len(games) == 2
    pairs = {(seed_by_team[m.team_a_id], seed_by_team[m.team_b_id]) for m in games}
    assert pairs == {(1, 4), (2, 3)}  # team_a is the better seed
    assert all(m.round == 1 and m.nfl_week == 15 and not m.is_finalized for m in games)


def test_generate_bracket_byes_are_auto_advanced_matchups(db_session, seed):
    # 6 qualifiers (field=3, two leagues) -> byes to the top two seeds
    season = seed.season(
        2025, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=3, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    for w, pf in [(12, "1600"), (10, "1500"), (8, "1400")]:
        seed.team(la, wins=w, losses=13 - w, points_for=Decimal(pf))
    for w, pf in [(11, "1550"), (9, "1450"), (7, "1350")]:
        seed.team(lb, wins=w, losses=13 - w, points_for=Decimal(pf))

    bracket = generate_bracket(db_session, season)
    byes = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, bye=True).all()
    games = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, bye=False).all()
    assert len(byes) == 2 and len(games) == 2  # 6 -> 2 byes + 2 games -> field of 4
    for b in byes:
        assert b.team_b_id is None
        assert b.winner_team_id == b.team_a_id
        assert b.is_finalized is True


def test_generate_bracket_too_few_teams_raises(db_session, seed):
    season = seed.season(
        2026, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=5, losses=8, points_for=Decimal("1000"))  # one team total
    with pytest.raises(BracketGenerationError):
        generate_bracket(db_session, season)


def test_generate_bracket_no_playoff_weeks_raises(db_session, seed):
    season = seed.season(
        2027, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    with pytest.raises(BracketGenerationError):
        generate_bracket(db_session, season)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/bracket/test_generation.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.bracket.generation'`.

- [ ] **Step 3: Implement the generation service**

Create `backend/app/bracket/generation.py`:

```python
from sqlalchemy.orm import Session

from app.bracket.engine import RemainingTeam, TeamStanding, generate_round, seed_field
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    League,
    QualifiedVia,
    Season,
    Team,
)


class BracketGenerationError(Exception):
    """A season cannot form a bracket (too few teams / no playoff weeks)."""


def generate_bracket(session: Session, season: Season) -> Bracket:
    """Seed the pooled field from final standings and create a PENDING bracket
    with its seeds and round-1 matchups (games high-vs-low; byes auto-advanced).
    Flushes but does not commit — the caller owns the transaction."""
    teams = (
        session.query(Team)
        .join(League, Team.league_id == League.id)
        .filter(League.season_id == season.id)
        .all()
    )
    standings = [
        TeamStanding(
            team_id=t.id,
            league_id=t.league_id,
            wins=t.wins,
            losses=t.losses,
            ties=t.ties,
            points_for=t.points_for,
        )
        for t in teams
    ]
    seeds = seed_field(standings, season.playoff_field_per_league)
    if len(seeds) < 2:
        raise BracketGenerationError("not enough teams to form a bracket")
    if not season.nfl_playoff_weeks:
        raise BracketGenerationError("season has no playoff weeks configured")

    bracket = Bracket(
        season_id=season.id, size=len(seeds), status=BracketStatus.PENDING
    )
    session.add(bracket)
    session.flush()

    for st in seeds:
        session.add(
            BracketSeed(
                bracket_id=bracket.id,
                team_id=st.team_id,
                seed=st.seed,
                qualified_via=QualifiedVia.AUTO,
            )
        )

    week = season.nfl_playoff_weeks[0]
    plan = generate_round([RemainingTeam(team_id=st.team_id, seed=st.seed) for st in seeds])
    for game in plan.games:
        session.add(
            BracketMatchup(
                bracket_id=bracket.id,
                round=1,
                nfl_week=week,
                team_a_id=game.high,
                team_b_id=game.low,
                bye=False,
                is_finalized=False,
            )
        )
    for bye_team_id in plan.byes:
        session.add(
            BracketMatchup(
                bracket_id=bracket.id,
                round=1,
                nfl_week=week,
                team_a_id=bye_team_id,
                team_b_id=None,
                bye=True,
                winner_team_id=bye_team_id,
                is_finalized=True,
            )
        )
    session.flush()
    return bracket
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/bracket/test_generation.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add app/bracket/generation.py tests/bracket/test_generation.py
git commit -m "feat: add generate_bracket service (seed + round-1 matchups via engine)"
```

---

### Task 2: Admin generate / approve / read endpoints

**Files:**
- Create: `backend/app/api/admin/bracket.py`, `backend/tests/api/admin/test_bracket.py`
- Modify: `backend/app/api/admin/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.api.deps.require_super_admin`; `app.bracket.generation.{generate_bracket, BracketGenerationError}`; `app.models.{Bracket, BracketMatchup, BracketSeed, BracketStatus, Season, SeasonStatus}`.
- Produces:
  - `admin.schemas.{BracketSeedAdmin, BracketMatchupAdmin, BracketAdminResponse}`.
  - `app.api.admin.bracket.router` — `POST /admin/seasons/{season_id}/bracket` (201), `POST /admin/seasons/{season_id}/bracket/approve`, `GET /admin/seasons/{season_id}/bracket`, mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/admin/test_bracket.py`:

```python
from decimal import Decimal

from app.api.security import create_access_token
from app.models import AccountRole, Bracket, BracketStatus, SeasonStatus


def _playoff_season_4(seed):
    season = seed.season(
        2024, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))
    return season


def _la_headers(make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_generate_requires_super_admin(client, seed, make_account):
    season = _playoff_season_4(seed)
    assert client.post(f"/admin/seasons/{season.id}/bracket").status_code == 401
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=_la_headers(make_account)
    ).status_code == 403


def test_generate_success(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    resp = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    assert body["size"] == 4
    assert len(body["seeds"]) == 4
    assert len([m for m in body["matchups"] if not m["bye"]]) == 2


def test_generate_season_not_playoffs_409(client, admin_headers, seed):
    season = seed.season(
        2030, status=SeasonStatus.REGULAR,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 409


def test_generate_unknown_season_404(client, admin_headers):
    assert client.post("/admin/seasons/999999/bracket", headers=admin_headers).status_code == 404


def test_generate_too_few_teams_422(client, admin_headers, seed):
    season = seed.season(
        2031, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=5, losses=8, points_for=Decimal("1000"))
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 422


def test_regenerate_replaces_pending(client, admin_headers, db_session, seed):
    season = _playoff_season_4(seed)
    first = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).json()
    second = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).json()
    assert second["status"] == "pending"
    assert first["id"] != second["id"]
    assert db_session.query(Bracket).filter_by(season_id=season.id).count() == 1


def test_generate_when_active_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 409


def test_approve_flips_to_active_then_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    resp = client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers
    ).status_code == 409


def test_approve_unknown_bracket_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers
    ).status_code == 404


def test_admin_read_returns_pending_and_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.get(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).status_code == 404
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    resp = client.get(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_bracket.py -v`
Expected: FAIL — 404 on `/admin/seasons/{id}/bracket` (router not mounted).

- [ ] **Step 3: Add the admin schemas**

Append to `backend/app/api/admin/schemas.py` (extend the existing `from app.models import ...` line to add `BracketStatus, QualifiedVia`):

```python
class BracketSeedAdmin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seed: int
    team_id: int
    qualified_via: QualifiedVia


class BracketMatchupAdmin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    round: int
    nfl_week: int
    team_a_id: int | None
    team_b_id: int | None
    team_a_score: float | None
    team_b_score: float | None
    winner_team_id: int | None
    is_finalized: bool
    bye: bool


class BracketAdminResponse(BaseModel):
    id: int
    season_id: int
    size: int
    status: BracketStatus
    seeds: list[BracketSeedAdmin]
    matchups: list[BracketMatchupAdmin]
```

- [ ] **Step 4: Implement the admin router**

Create `backend/app/api/admin/bracket.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    BracketAdminResponse,
    BracketMatchupAdmin,
    BracketSeedAdmin,
)
from app.api.deps import require_super_admin
from app.bracket.generation import BracketGenerationError, generate_bracket
from app.db import get_db
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    Season,
    SeasonStatus,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _get_bracket(db: Session, season_id: int) -> Bracket | None:
    return db.execute(
        select(Bracket).where(Bracket.season_id == season_id)
    ).scalar_one_or_none()


def _bracket_response(db: Session, bracket: Bracket) -> BracketAdminResponse:
    seeds = db.execute(
        select(BracketSeed)
        .where(BracketSeed.bracket_id == bracket.id)
        .order_by(BracketSeed.seed)
    ).scalars().all()
    matchups = db.execute(
        select(BracketMatchup)
        .where(BracketMatchup.bracket_id == bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
    ).scalars().all()
    return BracketAdminResponse(
        id=bracket.id,
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=[BracketSeedAdmin.model_validate(s) for s in seeds],
        matchups=[BracketMatchupAdmin.model_validate(m) for m in matchups],
    )


@router.post(
    "/seasons/{season_id}/bracket",
    response_model=BracketAdminResponse,
    status_code=201,
)
def generate_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    if season.status is not SeasonStatus.PLAYOFFS:
        raise HTTPException(status_code=409, detail="Season is not in playoffs")
    existing = _get_bracket(db, season_id)
    if existing is not None:
        if existing.status is not BracketStatus.PENDING:
            raise HTTPException(status_code=409, detail="Bracket already approved")
        db.delete(existing)
        db.flush()
    try:
        bracket = generate_bracket(db, season)
    except BracketGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _bracket_response(db, bracket)


@router.post(
    "/seasons/{season_id}/bracket/approve", response_model=BracketAdminResponse
)
def approve_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    if bracket.status is not BracketStatus.PENDING:
        raise HTTPException(status_code=409, detail="Bracket is not pending")
    bracket.status = BracketStatus.ACTIVE
    db.commit()
    return _bracket_response(db, bracket)


@router.get("/seasons/{season_id}/bracket", response_model=BracketAdminResponse)
def read_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    return _bracket_response(db, bracket)
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include it after `admin_accounts_router`:

```python
from app.api.admin.bracket import router as admin_bracket_router
```
```python
    app.include_router(admin_accounts_router)
    app.include_router(admin_bracket_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_bracket.py -v`
Expected: 10 passed.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/bracket.py app/api/admin/schemas.py app/main.py tests/api/admin/test_bracket.py
git commit -m "feat: add admin bracket generate/approve/read endpoints"
```

---

### Task 3: Public bracket read

**Files:**
- Create: `backend/app/api/bracket.py`, `backend/tests/api/test_bracket.py`
- Modify: `backend/app/api/public_schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `app.db.get_db`; `app.models.{Bracket, BracketMatchup, BracketSeed, BracketStatus, Owner, Team}`; `app.api.public_schemas.OwnerRef`; the admin generate/approve endpoints (Task 2) in tests.
- Produces:
  - `public_schemas.{BracketTeamRef, BracketMatchupPublic, BracketRoundPublic, BracketPublic}`.
  - `app.api.bracket.router` — `GET /seasons/{season_id}/bracket` (public), mounted in `create_app()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_bracket.py`:

```python
from decimal import Decimal

from app.models import Bracket, BracketStatus, SeasonStatus


def _playoff_season_4(seed):
    season = seed.season(
        2024, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="Alpha")
    lb = seed.league(season, name="Beta")
    owner = seed.owner(first_name="Jack", last_name="A")
    seed.team(la, owner=owner, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))
    return season


def _generate_and_approve(client, admin_headers, season):
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)


def test_public_bracket_404_when_absent(client, seed):
    season = _playoff_season_4(seed)
    assert client.get(f"/seasons/{season.id}/bracket").status_code == 404


def test_public_bracket_404_when_pending(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)  # PENDING
    assert client.get(f"/seasons/{season.id}/bracket").status_code == 404


def test_public_bracket_visible_after_approval(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    _generate_and_approve(client, admin_headers, season)
    resp = client.get(f"/seasons/{season.id}/bracket")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["size"] == 4
    assert len(body["seeds"]) == 4
    assert len(body["rounds"]) == 1
    rnd = body["rounds"][0]
    assert rnd["round"] == 1 and rnd["nfl_week"] == 15
    assert len(rnd["matchups"]) == 2
    seed1 = next(s for s in body["seeds"] if s["seed"] == 1)
    assert seed1["league_name"] == "Alpha"
    assert seed1["owner"]["first_name"] == "Jack"
    m = rnd["matchups"][0]
    assert m["team_a_score"] is None and m["team_b_score"] is None


def test_public_bracket_visible_when_complete(client, admin_headers, db_session, seed):
    season = _playoff_season_4(seed)
    _generate_and_approve(client, admin_headers, season)
    bracket = db_session.query(Bracket).filter_by(season_id=season.id).one()
    bracket.status = BracketStatus.COMPLETE
    db_session.commit()
    resp = client.get(f"/seasons/{season.id}/bracket")
    assert resp.status_code == 200
    assert resp.json()["status"] == "complete"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_bracket.py -v`
Expected: FAIL — 404 on `/seasons/{id}/bracket` (router not mounted; note the admin routes from Task 2 are what the helpers call, and they already exist).

- [ ] **Step 3: Add the public schemas**

Append to `backend/app/api/public_schemas.py` (extend the existing `from app.models import SeasonStatus` line to add `BracketStatus`):

```python
class BracketTeamRef(BaseModel):
    team_id: int
    seed: int
    league_name: str
    owner: OwnerRef | None


class BracketMatchupPublic(BaseModel):
    round: int
    nfl_week: int
    bye: bool
    is_finalized: bool
    team_a: BracketTeamRef | None
    team_b: BracketTeamRef | None
    team_a_score: float | None
    team_b_score: float | None
    winner_team_id: int | None


class BracketRoundPublic(BaseModel):
    round: int
    nfl_week: int
    matchups: list[BracketMatchupPublic]


class BracketPublic(BaseModel):
    season_id: int
    size: int
    status: BracketStatus
    seeds: list[BracketTeamRef]
    rounds: list[BracketRoundPublic]
```

- [ ] **Step 4: Implement the public router**

Create `backend/app/api/bracket.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import (
    BracketMatchupPublic,
    BracketPublic,
    BracketRoundPublic,
    BracketTeamRef,
    OwnerRef,
)
from app.db import get_db
from app.models import Bracket, BracketMatchup, BracketSeed, BracketStatus, Owner, Team

router = APIRouter(tags=["public"])

_PUBLIC_STATUSES = {BracketStatus.ACTIVE, BracketStatus.COMPLETE}


@router.get("/seasons/{season_id}/bracket", response_model=BracketPublic)
def get_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketPublic:
    bracket = db.execute(
        select(Bracket).where(Bracket.season_id == season_id)
    ).scalar_one_or_none()
    if bracket is None or bracket.status not in _PUBLIC_STATUSES:
        raise HTTPException(status_code=404, detail="Bracket not found")

    seed_rows = db.execute(
        select(BracketSeed)
        .where(BracketSeed.bracket_id == bracket.id)
        .order_by(BracketSeed.seed)
    ).scalars().all()
    seed_by_team = {s.team_id: s.seed for s in seed_rows}

    def team_ref(team_id: int | None) -> BracketTeamRef | None:
        if team_id is None:
            return None
        team = db.get(Team, team_id)
        owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
        return BracketTeamRef(
            team_id=team.id,
            seed=seed_by_team.get(team.id, 0),
            league_name=team.league.name,
            owner=OwnerRef.model_validate(owner) if owner is not None else None,
        )

    def score(value) -> float | None:
        return float(value) if value is not None else None

    matchups = db.execute(
        select(BracketMatchup)
        .where(BracketMatchup.bracket_id == bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
    ).scalars().all()

    by_round: dict[int, list[BracketMatchup]] = {}
    for m in matchups:
        by_round.setdefault(m.round, []).append(m)

    rounds = [
        BracketRoundPublic(
            round=rnd,
            nfl_week=group[0].nfl_week,
            matchups=[
                BracketMatchupPublic(
                    round=m.round,
                    nfl_week=m.nfl_week,
                    bye=m.bye,
                    is_finalized=m.is_finalized,
                    team_a=team_ref(m.team_a_id),
                    team_b=team_ref(m.team_b_id),
                    team_a_score=score(m.team_a_score),
                    team_b_score=score(m.team_b_score),
                    winner_team_id=m.winner_team_id,
                )
                for m in group
            ],
        )
        for rnd, group in sorted(by_round.items())
    ]

    return BracketPublic(
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=[team_ref(s.team_id) for s in seed_rows],
        rounds=rounds,
    )
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import and include it with the other public routers (after `owners_router`):

```python
from app.api.bracket import router as bracket_router
```
```python
    app.include_router(owners_router)
    app.include_router(bracket_router)
```

- [ ] **Step 6: Run the public tests, then the full suite**

Run: `uv run pytest tests/api/test_bracket.py -v`
Expected: 4 passed.

Run: `uv run pytest`
Expected: full suite green (previous total + 5 generation + 10 admin + 4 public), only the known baseline warnings.

- [ ] **Step 7: Commit**

```bash
git add app/api/bracket.py app/api/public_schemas.py app/main.py tests/api/test_bracket.py
git commit -m "feat: add public bracket read (ACTIVE/COMPLETE, grouped into rounds)"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green, only the known baseline warnings.
- Manual smoke (optional, needs dev DB): flip a season to PLAYOFFS (API-3a PATCH), `POST /admin/seasons/{id}/bracket`, confirm the PENDING draft's seeds + round-1 pairings (and any byes), `GET /seasons/{id}/bracket` returns 404 (still PENDING), `POST .../bracket/approve`, then `GET /seasons/{id}/bracket` returns the ACTIVE bracket with enriched team refs and null scores. Confirm regenerating before approval replaces the draft, and generating after approval is a 409.
