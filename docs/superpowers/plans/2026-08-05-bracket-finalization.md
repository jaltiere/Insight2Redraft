# Round Finalization + Advancement + Worker Live Scores (API-4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin can finalize the current bracket round (decide games by the platform recompute, advance to the next round or complete the bracket), and the sync worker keeps the in-progress round's matchup scores live during games.

**Architecture:** A pure-DB `finalize_current_round` + `update_bracket_live_scores` service (`app/bracket/finalization.py`) composes the 4a engine with the bracket tables. A super-admin `finalize-round` endpoint extends the 4b admin router. The worker's `run_cycle` calls the live-score updater each cycle. No model changes, no migration.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-bracket-finalization-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`. Postgres REQUIRED (test DB `insight2redraft_test`).
- **Finalize is pure DB — no Sleeper I/O.** Matchups are decided by `WeeklyScore.recomputed_points` (starter), then `bench_points`, then better seed (`resolve_matchup`). The service flushes; the endpoint commits.
- **All finalize guards are checked BEFORE any mutation** (all-or-nothing): missing/`None` `recomputed_points` for a game team → `ScoresNotSynced`; a next round needed but no configured week → `NotEnoughPlayoffWeeks`; no unfinalized round → `NothingToFinalize`.
- **The worker's live-score updater never sets `winner_team_id`/`is_finalized`** (finalization is admin-only) and is idempotent.
- **Error mapping:** 401 no token / 403 non-super-admin (router-level gate); finalize 404 no bracket, 409 not-ACTIVE / scores-not-synced / nothing-to-finalize, 422 not-enough-playoff-weeks.
- Champion is derived (no explicit champion field, no `Team.league_finish` write). One-way (no undo).
- The pure engine (`app/bracket/engine.py`) is NOT modified. No new dependencies. Reuse `BracketAdminResponse` (4b) — no new schema.
- Known warning baseline: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem.

## File Structure

- Create: `app/bracket/finalization.py`, `tests/bracket/test_finalization.py`
- Modify: `app/api/admin/bracket.py` (finalize route), `tests/api/admin/test_bracket.py` (finalize tests), `app/worker/cycle.py` (call updater), `tests/worker/test_cycle.py` (live-score test)

Grounding (already in the codebase):
- Engine (pure): `resolve_matchup(MatchupSide{team_id, seed, starter_points, bench_points}, ...) -> team_id`; `generate_round(remaining: [RemainingTeam{team_id, seed}]) -> RoundPlan{games: [RoundGame{high, low}], byes: [int]}` (requires N>=2); import from `app.bracket.engine`.
- `app.bracket.generation.generate_bracket(session, season) -> Bracket` (creates PENDING bracket + seeds + round-1 matchups) — used by tests to build a bracket, then set status ACTIVE.
- Models: `WeeklyScore(team_id, week, sleeper_points, recomputed_points: Decimal|None, bench_points: Decimal|None, is_final)`; `BracketMatchup(bracket_id, round, nfl_week, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, is_finalized, bye)`; `BracketSeed(bracket_id, team_id, seed)`; `Bracket(season_id, size, status: BracketStatus)`; `Season(nfl_playoff_weeks)`.
- 4b admin router `app/api/admin/bracket.py`: router-level `require_super_admin`; module helpers `_get_bracket(db, season_id) -> Bracket|None` and `_bracket_response(db, bracket) -> BracketAdminResponse`; imports `BracketStatus`, `Season`, `SeasonStatus`, etc.
- Worker `app/worker/cycle.py` `run_cycle`: computes `season_id`, `week`, iterates `league_ids` syncing each in a `session_factory.begin()` block, then `_maybe_sync_players(...)`. `logger` is module-level.
- Worker tests (`tests/worker/test_cycle.py`): `session_factory` fixture; `_STATE = {"season": "2024", "week": 5, ...}`; `_base_routes()` (nfl_state week 5 + league 987654321 matchups/rosters/users/league + stats/2024/5 + players); `UTC_NOW`, `fixed_clock`, `route_client`, `load_fixture` from `tests.worker.conftest`. A REGULAR cycle creates 2 `WeeklyScore` rows (roster_id 1, 2).
- Fixtures: `db_session`, `seed` (`seed.season(year, status=, playoff_field_per_league=, nfl_playoff_weeks=)`, `seed.league`, `seed.team(league, wins=, losses=, points_for=)`), `client`, `admin_headers`, `make_account`.

---

### Task 1: Finalization service + live-score updater

**Files:**
- Create: `backend/app/bracket/finalization.py`, `backend/tests/bracket/test_finalization.py`

**Interfaces:**
- Consumes: `app.bracket.engine.{MatchupSide, RemainingTeam, generate_round, resolve_matchup}`; `app.bracket.generation.generate_bracket` (tests); `app.models.{Bracket, BracketMatchup, BracketSeed, BracketStatus, Season, WeeklyScore}`.
- Produces: `app.bracket.finalization.{FinalizeError, ScoresNotSynced, NothingToFinalize, NotEnoughPlayoffWeeks}`; `finalize_current_round(session, bracket) -> Bracket` (flush, no commit); `update_bracket_live_scores(session, season_id, week) -> int`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/bracket/test_finalization.py`:

```python
from decimal import Decimal

import pytest

from app.bracket.finalization import (
    NothingToFinalize,
    NotEnoughPlayoffWeeks,
    ScoresNotSynced,
    finalize_current_round,
    update_bracket_live_scores,
)
from app.bracket.generation import generate_bracket
from app.models import BracketMatchup, BracketSeed, BracketStatus, SeasonStatus, WeeklyScore


def _active_bracket_4(db_session, seed, *, year=2024, weeks=(15, 16, 17)):
    season = seed.season(
        year, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=list(weeks),
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))  # seed 1
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))   # seed 3
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))   # seed 2
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))   # seed 4
    bracket = generate_bracket(db_session, season)
    bracket.status = BracketStatus.ACTIVE
    db_session.flush()
    return season, bracket


def _active_bracket_6(db_session, seed, *, year=2030, weeks=(15, 16, 17)):
    season = seed.season(
        year, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=3, nfl_playoff_weeks=list(weeks),
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    for w, pf in [(12, "1600"), (10, "1500"), (8, "1400")]:
        seed.team(la, wins=w, losses=13 - w, points_for=Decimal(pf))
    for w, pf in [(11, "1550"), (9, "1450"), (7, "1350")]:
        seed.team(lb, wins=w, losses=13 - w, points_for=Decimal(pf))
    bracket = generate_bracket(db_session, season)
    bracket.status = BracketStatus.ACTIVE
    db_session.flush()
    return season, bracket


def _seed_map(db_session, bracket):
    return {s.seed: s.team_id for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)}


def _weekly(db_session, team_id, week, recomputed, bench="0"):
    db_session.add(
        WeeklyScore(
            team_id=team_id, week=week,
            sleeper_points=Decimal(recomputed),
            recomputed_points=Decimal(recomputed),
            bench_points=Decimal(bench),
        )
    )
    db_session.flush()


def test_finalize_round_one_advances(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)

    finalize_current_round(db_session, bracket)

    r1 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=1, bye=False).all()
    assert all(g.is_finalized and g.winner_team_id is not None for g in r1)
    assert {g.winner_team_id for g in r1} == {m[1], m[2]}
    assert db_session.query(WeeklyScore).filter_by(team_id=m[1], week=15).one().is_final is True
    r2 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2).all()
    assert len(r2) == 1 and r2[0].nfl_week == 16 and not r2[0].is_finalized
    assert bracket.status is BracketStatus.ACTIVE


def test_finalize_round_one_advances_byes(db_session, seed):
    # 6 teams -> round 1: byes to seeds 1,2; games seed3v6, seed4v5 at week 15
    season, bracket = _active_bracket_6(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(3, "100"), (6, "90"), (4, "100"), (5, "80")]:
        _weekly(db_session, m[s], 15, pts)  # seeds 3 and 4 win their games

    finalize_current_round(db_session, bracket)

    r2 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2).all()
    r2_team_ids = {tid for g in r2 for tid in (g.team_a_id, g.team_b_id)}
    assert r2_team_ids == {m[1], m[2], m[3], m[4]}  # byes 1,2 + winners 3,4 advance
    assert bracket.status is BracketStatus.ACTIVE


def test_finalize_bench_breaks_starter_tie(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    # seed1 vs seed4: equal starters, seed4 higher bench -> seed4 upsets
    _weekly(db_session, m[1], 15, "100", bench="10")
    _weekly(db_session, m[4], 15, "100", bench="50")
    _weekly(db_session, m[2], 15, "110")
    _weekly(db_session, m[3], 15, "90")

    finalize_current_round(db_session, bracket)

    game = db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, team_a_id=m[1]
    ).one()
    assert game.winner_team_id == m[4]


def test_finalize_final_round_completes(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)  # -> round 2 (seeds 1,2)
    _weekly(db_session, m[1], 16, "130")
    _weekly(db_session, m[2], 16, "120")

    finalize_current_round(db_session, bracket)

    assert bracket.status is BracketStatus.COMPLETE
    assert db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=3).count() == 0
    final = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2, bye=False).one()
    assert final.winner_team_id == m[1]


def test_finalize_scores_not_synced_raises(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    with pytest.raises(ScoresNotSynced):
        finalize_current_round(db_session, bracket)


def test_finalize_not_enough_playoff_weeks_raises_before_mutation(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed, year=2028, weeks=(15,))  # only one week
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)

    with pytest.raises(NotEnoughPlayoffWeeks):
        finalize_current_round(db_session, bracket)

    # all-or-nothing: no round-1 game was finalized
    assert db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, bye=False, is_finalized=True
    ).count() == 0


def test_finalize_nothing_to_finalize_when_complete(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)
    _weekly(db_session, m[1], 16, "130")
    _weekly(db_session, m[2], 16, "120")
    finalize_current_round(db_session, bracket)  # -> COMPLETE

    with pytest.raises(NothingToFinalize):
        finalize_current_round(db_session, bracket)


def test_update_live_scores_copies_recomputed(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "55.5"), (4, "48.0"), (2, "60"), (3, "40")]:
        _weekly(db_session, m[s], 15, pts)

    updated = update_bracket_live_scores(db_session, season.id, 15)

    assert updated == 2
    game = db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, team_a_id=m[1]
    ).one()
    assert str(game.team_a_score) == "55.50"
    assert game.winner_team_id is None and not game.is_finalized


def test_update_live_scores_skips_finalized(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)  # round 1 finalized

    assert update_bracket_live_scores(db_session, season.id, 15) == 0


def test_update_live_scores_noop_without_active_bracket(db_session, seed):
    season = seed.season(
        2029, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16],
    )
    assert update_bracket_live_scores(db_session, season.id, 15) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/bracket/test_finalization.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.bracket.finalization'`.

- [ ] **Step 3: Implement the finalization service**

Create `backend/app/bracket/finalization.py`:

```python
from decimal import Decimal

from sqlalchemy.orm import Session

from app.bracket.engine import (
    MatchupSide,
    RemainingTeam,
    generate_round,
    resolve_matchup,
)
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    Season,
    WeeklyScore,
)


class FinalizeError(Exception):
    """Base for round-finalization failures."""


class ScoresNotSynced(FinalizeError):
    """A game team has no synced recomputed score for the round's week."""


class NothingToFinalize(FinalizeError):
    """No unfinalized round remains."""


class NotEnoughPlayoffWeeks(FinalizeError):
    """The season has no configured NFL week for the next round."""


def finalize_current_round(session: Session, bracket: Bracket) -> Bracket:
    """Decide the current round from already-synced WeeklyScore data, lock those
    scores, and advance the bracket (next round via the engine, or COMPLETE).
    All guards are checked before any mutation. Flushes but does not commit."""
    matchups = (
        session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
        .all()
    )
    unfinalized_rounds = [m.round for m in matchups if not m.is_finalized]
    if not unfinalized_rounds:
        raise NothingToFinalize("no round to finalize")
    current_round = min(unfinalized_rounds)
    round_matchups = [m for m in matchups if m.round == current_round]
    games = [m for m in round_matchups if not m.bye]
    week = round_matchups[0].nfl_week
    seed_by_team = {
        s.team_id: s.seed
        for s in session.query(BracketSeed).filter_by(bracket_id=bracket.id)
    }

    game_team_ids = [tid for g in games for tid in (g.team_a_id, g.team_b_id)]
    ws_by_team = {
        ws.team_id: ws
        for ws in session.query(WeeklyScore).filter(
            WeeklyScore.team_id.in_(game_team_ids), WeeklyScore.week == week
        )
    }
    for tid in game_team_ids:
        ws = ws_by_team.get(tid)
        if ws is None or ws.recomputed_points is None:
            raise ScoresNotSynced(f"scores not synced for week {week}")

    season = session.get(Season, bracket.season_id)
    survivor_count = len(round_matchups)
    if survivor_count > 1 and len(season.nfl_playoff_weeks) <= current_round:
        raise NotEnoughPlayoffWeeks(f"no playoff week for round {current_round + 1}")

    for g in games:
        a = ws_by_team[g.team_a_id]
        b = ws_by_team[g.team_b_id]
        winner = resolve_matchup(
            MatchupSide(
                team_id=g.team_a_id,
                seed=seed_by_team[g.team_a_id],
                starter_points=a.recomputed_points,
                bench_points=a.bench_points or Decimal("0"),
            ),
            MatchupSide(
                team_id=g.team_b_id,
                seed=seed_by_team[g.team_b_id],
                starter_points=b.recomputed_points,
                bench_points=b.bench_points or Decimal("0"),
            ),
        )
        g.team_a_score = a.recomputed_points
        g.team_b_score = b.recomputed_points
        g.winner_team_id = winner
        g.is_finalized = True
        a.is_final = True
        b.is_final = True

    survivors = [
        RemainingTeam(team_id=m.winner_team_id, seed=seed_by_team[m.winner_team_id])
        for m in round_matchups
    ]
    if len(survivors) == 1:
        bracket.status = BracketStatus.COMPLETE
    else:
        next_round = current_round + 1
        next_week = season.nfl_playoff_weeks[current_round]  # 0-indexed: round n -> index n-1
        plan = generate_round(survivors)
        for game in plan.games:
            session.add(
                BracketMatchup(
                    bracket_id=bracket.id,
                    round=next_round,
                    nfl_week=next_week,
                    team_a_id=game.high,
                    team_b_id=game.low,
                    bye=False,
                    is_finalized=False,
                )
            )
        for bye_tid in plan.byes:
            session.add(
                BracketMatchup(
                    bracket_id=bracket.id,
                    round=next_round,
                    nfl_week=next_week,
                    team_a_id=bye_tid,
                    team_b_id=None,
                    bye=True,
                    winner_team_id=bye_tid,
                    is_finalized=True,
                )
            )
    session.flush()
    return bracket


def update_bracket_live_scores(session: Session, season_id: int, week: int) -> int:
    """Copy recomputed_points into the ACTIVE bracket's current-week, unfinalized,
    non-bye matchups. Never sets winner/is_finalized. Returns the number of
    matchups touched. Idempotent no-op when there is no ACTIVE bracket."""
    bracket = (
        session.query(Bracket)
        .filter_by(season_id=season_id, status=BracketStatus.ACTIVE)
        .one_or_none()
    )
    if bracket is None:
        return 0
    matchups = (
        session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id, nfl_week=week, is_finalized=False, bye=False)
        .all()
    )
    if not matchups:
        return 0
    team_ids = [tid for m in matchups for tid in (m.team_a_id, m.team_b_id) if tid is not None]
    recomputed = {
        ws.team_id: ws.recomputed_points
        for ws in session.query(WeeklyScore).filter(
            WeeklyScore.team_id.in_(team_ids), WeeklyScore.week == week
        )
        if ws.recomputed_points is not None
    }
    updated = 0
    for m in matchups:
        touched = False
        if m.team_a_id in recomputed:
            m.team_a_score = recomputed[m.team_a_id]
            touched = True
        if m.team_b_id in recomputed:
            m.team_b_score = recomputed[m.team_b_id]
            touched = True
        if touched:
            updated += 1
    session.flush()
    return updated
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/bracket/test_finalization.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add app/bracket/finalization.py tests/bracket/test_finalization.py
git commit -m "feat: add bracket finalize_current_round + live-score updater"
```

---

### Task 2: Finalize endpoint

**Files:**
- Modify: `backend/app/api/admin/bracket.py`, `backend/tests/api/admin/test_bracket.py`

**Interfaces:**
- Consumes: the 4b module's `_get_bracket`, `_bracket_response`, `router`, `BracketStatus`; `app.bracket.finalization.{finalize_current_round, ScoresNotSynced, NothingToFinalize, NotEnoughPlayoffWeeks}`.
- Produces: `POST /admin/seasons/{season_id}/bracket/finalize-round` (returns `BracketAdminResponse`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/admin/test_bracket.py` (add `BracketSeed, WeeklyScore` to the existing `from app.models import ...` line, and `from decimal import Decimal` / `from app.api.security import create_access_token` if not already imported at the top):

```python
def _active_season_with_bracket(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    return season


def test_finalize_round_advances(client, admin_headers, db_session, seed):
    season = _active_season_with_bracket(client, admin_headers, seed)
    bracket = db_session.query(Bracket).filter_by(season_id=season.id).one()
    by_seed = {s.seed: s.team_id for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)}
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        db_session.add(
            WeeklyScore(
                team_id=by_seed[s], week=15,
                sleeper_points=Decimal(pts), recomputed_points=Decimal(pts),
                bench_points=Decimal("0"),
            )
        )
    db_session.commit()

    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert 2 in {m["round"] for m in body["matchups"]}  # next round created


def test_finalize_scores_not_synced_409(client, admin_headers, seed):
    season = _active_season_with_bracket(client, admin_headers, seed)
    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 409


def test_finalize_not_active_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)  # PENDING, unapproved
    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 409


def test_finalize_unknown_bracket_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers
    ).status_code == 404


def test_finalize_requires_super_admin(client, seed, make_account):
    season = _playoff_season_4(seed)
    assert client.post(f"/admin/seasons/{season.id}/bracket/finalize-round").status_code == 401
    la = make_account("finla@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    headers = {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/finalize-round", headers=headers
    ).status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/admin/test_bracket.py -k finalize -v`
Expected: FAIL — 404/405 on `/admin/seasons/{id}/bracket/finalize-round` (route not defined).

- [ ] **Step 3: Implement the finalize endpoint**

In `backend/app/api/admin/bracket.py`, add the import (with the existing `from app.bracket.generation import ...`):

```python
from app.bracket.finalization import (
    NothingToFinalize,
    NotEnoughPlayoffWeeks,
    ScoresNotSynced,
    finalize_current_round,
)
```

Append this route (after `read_season_bracket`):

```python
@router.post(
    "/seasons/{season_id}/bracket/finalize-round",
    response_model=BracketAdminResponse,
)
def finalize_season_bracket_round(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    if bracket.status is not BracketStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Bracket is not active")
    try:
        finalize_current_round(db, bracket)
    except (ScoresNotSynced, NothingToFinalize) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotEnoughPlayoffWeeks as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _bracket_response(db, bracket)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/admin/test_bracket.py -v`
Expected: all pass (the 10 existing bracket tests + 5 new finalize tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bracket.py tests/api/admin/test_bracket.py
git commit -m "feat: add admin finalize-round endpoint"
```

---

### Task 3: Worker live-score wiring

**Files:**
- Modify: `backend/app/worker/cycle.py`, `backend/tests/worker/test_cycle.py`

**Interfaces:**
- Consumes: `app.bracket.finalization.update_bracket_live_scores`.
- Produces: `run_cycle` calls `update_bracket_live_scores(session, season_id, week)` once per cycle after the per-league sync loop, in its own guarded `session_factory.begin()` block.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/worker/test_cycle.py` (add `Team` to the existing `from app.models import ...` line; add `from decimal import Decimal` if not present; add `from app.models import Bracket, BracketMatchup, BracketSeed, BracketStatus`):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/worker/test_cycle.py::test_run_cycle_updates_bracket_live_scores -v`
Expected: FAIL — `game.team_a_score is None` (the worker doesn't update bracket scores yet).

- [ ] **Step 3: Wire the updater into `run_cycle`**

In `backend/app/worker/cycle.py`, add the import (with the other `app.*` imports):

```python
from app.bracket.finalization import update_bracket_live_scores
```

In `run_cycle`, immediately after the `for league_id in league_ids:` loop and before `players_synced = await _maybe_sync_players(...)`, add:

```python
    try:
        with session_factory.begin() as session:
            update_bracket_live_scores(session, season_id, week)
    except Exception:
        logger.exception("bracket live-score update failed")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/worker/test_cycle.py -v`
Expected: all pass (the new live-score test + the existing cycle tests).

- [ ] **Step 5: Run the full suite**

Run: `uv run pytest`
Expected: full suite green (previous total + 10 finalization + 5 finalize-endpoint + 1 worker), only the known baseline warnings.

- [ ] **Step 6: Commit**

```bash
git add app/worker/cycle.py tests/worker/test_cycle.py
git commit -m "feat: worker copies live bracket scores each cycle"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green, only the known baseline warnings.
- Manual smoke (optional, needs dev DB): with an ACTIVE bracket and synced week scores, `POST /admin/seasons/{id}/bracket/finalize-round` → confirm the round's winners are set from recomputed points, `WeeklyScore.is_final` is locked, and either a next round appears (with the next playoff week) or the bracket flips to COMPLETE. Confirm 409 when scores aren't synced or the bracket isn't ACTIVE, and 422 when the season lacks a week for the next round. Run the worker during a game window and confirm the public bracket's current-round scores update without finalizing.
