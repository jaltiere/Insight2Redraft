# Bracket Engine (API-4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-logic `bracket_engine` module — seed the pooled playoff field, generate each round's reseeded high-vs-low pairings with byes, and resolve a single matchup — with exhaustive unit tests and no DB/API/I/O.

**Architecture:** A new `app/bracket/` package with `engine.py`, mirroring `app/scoring/engine.py`: module-level pure functions over frozen dataclasses, `Decimal` for points, exact/rational win% via `fractions.Fraction`. Three functions: `resolve_matchup`, `seed_field`, `generate_round`. Consumed later by API-4b (generation) and API-4c (finalization).

**Tech Stack:** Python 3.14 stdlib only (`dataclasses`, `decimal`, `fractions`, `collections.abc`), pytest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-bracket-engine-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- **Pure functions only** — no DB, no network, no global state, no ORM imports. `Decimal` for all points; win% compared exactly (via `Fraction`), never as float.
- No new dependencies (all stdlib). No model changes, no API wiring, no migration.
- Seeds are unique within a bracket, so `resolve_matchup`'s seed fallback always decides.
- Known warning baseline in test output: PyJWT `InsecureKeyLengthWarning` + `StarletteDeprecationWarning`. Anything new is a problem. (These pure tests should emit none themselves.)

## File Structure

- Create: `app/bracket/__init__.py` (empty), `app/bracket/engine.py`, `tests/bracket/__init__.py` (empty), `tests/bracket/test_engine.py`
- No other files change.

Reused convention: `app/scoring/engine.py` (pure module-level functions, `Decimal`, docstrings).

---

### Task 1: Package + dataclasses + `resolve_matchup`

**Files:**
- Create: `backend/app/bracket/__init__.py`, `backend/app/bracket/engine.py`, `backend/tests/bracket/__init__.py`, `backend/tests/bracket/test_engine.py`

**Interfaces:**
- Produces (all `@dataclass(frozen=True)` in `app.bracket.engine`): `TeamStanding{team_id:int, league_id:int, wins:int, losses:int, ties:int, points_for:Decimal}`; `SeededTeam{team_id:int, seed:int}`; `RemainingTeam{team_id:int, seed:int}`; `RoundGame{high:int, low:int}`; `RoundPlan{games:list[RoundGame], byes:list[int]}`; `MatchupSide{team_id:int, seed:int, starter_points:Decimal, bench_points:Decimal}`. Function `resolve_matchup(a: MatchupSide, b: MatchupSide) -> int` returning the winning `team_id`.
- These dataclasses are the shared interface consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Create empty `backend/app/bracket/__init__.py` and `backend/tests/bracket/__init__.py`.

Create `backend/tests/bracket/test_engine.py`:

```python
from decimal import Decimal

from app.bracket.engine import MatchupSide, resolve_matchup


def _side(team_id, seed, starter, bench):
    return MatchupSide(
        team_id=team_id,
        seed=seed,
        starter_points=Decimal(str(starter)),
        bench_points=Decimal(str(bench)),
    )


def test_resolve_higher_starter_points_wins():
    a = _side(1, 1, "120.5", "40")
    b = _side(2, 8, "118.0", "90")
    assert resolve_matchup(a, b) == 1
    assert resolve_matchup(b, a) == 1  # order-independent


def test_resolve_bench_breaks_starter_tie():
    a = _side(1, 3, "100.0", "30.0")
    b = _side(2, 4, "100.0", "45.0")
    assert resolve_matchup(a, b) == 2
    assert resolve_matchup(b, a) == 2


def test_resolve_seed_breaks_full_tie():
    a = _side(1, 2, "100.0", "50.0")
    b = _side(2, 5, "100.0", "50.0")
    assert resolve_matchup(a, b) == 1  # seed 2 is better than seed 5
    assert resolve_matchup(b, a) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/bracket/test_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.bracket'` (or import error for `engine`).

- [ ] **Step 3: Implement the dataclasses + `resolve_matchup`**

Create `backend/app/bracket/engine.py`:

```python
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction


@dataclass(frozen=True)
class TeamStanding:
    team_id: int
    league_id: int
    wins: int
    losses: int
    ties: int
    points_for: Decimal


@dataclass(frozen=True)
class SeededTeam:
    team_id: int
    seed: int  # 1..K, 1 = best


@dataclass(frozen=True)
class RemainingTeam:
    team_id: int
    seed: int  # original seed, carried every round


@dataclass(frozen=True)
class RoundGame:
    high: int  # team_id of the better (lower-numbered) original seed
    low: int  # team_id of the worse original seed


@dataclass(frozen=True)
class RoundPlan:
    games: list[RoundGame]
    byes: list[int]  # team_ids of top seeds receiving a bye


@dataclass(frozen=True)
class MatchupSide:
    team_id: int
    seed: int
    starter_points: Decimal
    bench_points: Decimal


def resolve_matchup(a: MatchupSide, b: MatchupSide) -> int:
    """Return the winning team_id: higher starter points, then higher bench
    points, then better (lower-numbered) original seed. Seeds are unique within
    a bracket, so the seed fallback always decides."""
    if a.starter_points != b.starter_points:
        return a.team_id if a.starter_points > b.starter_points else b.team_id
    if a.bench_points != b.bench_points:
        return a.team_id if a.bench_points > b.bench_points else b.team_id
    return a.team_id if a.seed < b.seed else b.team_id
```

(The `Iterable` and `Fraction` imports are used by Tasks 2 and 3; include them now so the module's import block is complete and later tasks only add function bodies.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/bracket/test_engine.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/bracket/__init__.py app/bracket/engine.py tests/bracket/__init__.py tests/bracket/test_engine.py
git commit -m "feat: add bracket engine dataclasses + resolve_matchup"
```

---

### Task 2: `seed_field`

**Files:**
- Modify: `backend/app/bracket/engine.py`, `backend/tests/bracket/test_engine.py`

**Interfaces:**
- Consumes: `TeamStanding`, `SeededTeam` (Task 1).
- Produces: `seed_field(standings: Iterable[TeamStanding], field_per_league: int) -> list[SeededTeam]` — top-`field_per_league` per league, pooled and seeded `1..K` by `(win_pct desc, points_for desc, team_id asc)` with `win_pct = (wins + ties/2)/games` (0 games → 0). Module-private helper `_rank_key`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/bracket/test_engine.py` (add `TeamStanding, seed_field` to the existing `from app.bracket.engine import ...` line — the tests read result attributes rather than constructing `SeededTeam`, so don't import it):

```python
def _st(team_id, league_id, w, l, t=0, pf="0"):
    return TeamStanding(
        team_id=team_id, league_id=league_id, wins=w, losses=l, ties=t,
        points_for=Decimal(pf),
    )


def _seeds(result):
    return [(s.team_id, s.seed) for s in result]


def test_seed_field_top_n_per_league_and_pooled_order():
    standings = [
        _st(1, 10, 10, 3, pf="1500"),
        _st(2, 10, 8, 5, pf="1400"),
        _st(3, 10, 4, 9, pf="1200"),  # cut (N=2)
        _st(4, 20, 9, 4, pf="1450"),
        _st(5, 20, 7, 6, pf="1390"),
        _st(6, 20, 2, 11, pf="1100"),  # cut
    ]
    result = seed_field(standings, field_per_league=2)
    # win%: 1=.769, 4=.692, 2=.615, 5=.538
    assert _seeds(result) == [(1, 1), (4, 2), (2, 3), (5, 4)]


def test_seed_field_points_for_breaks_equal_record():
    standings = [
        _st(1, 10, 9, 4, pf="1400"),
        _st(2, 20, 9, 4, pf="1500"),  # same record, more PF -> seed 1
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(2, 1), (1, 2)]


def test_seed_field_team_id_breaks_full_tie():
    standings = [
        _st(7, 10, 9, 4, pf="1400"),
        _st(3, 20, 9, 4, pf="1400"),  # identical record + PF -> lower team_id first
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(3, 1), (7, 2)]


def test_seed_field_ties_count_as_half():
    # A 8-4-1 -> 17/26 = .654 ; B 8-5-0 -> 16/26 = .615 ; A ranks higher despite lower PF
    standings = [
        _st(1, 10, 8, 4, t=1, pf="1000"),
        _st(2, 20, 8, 5, t=0, pf="9999"),
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(1, 1), (2, 2)]


def test_seed_field_league_with_fewer_than_n_contributes_all():
    standings = [
        _st(1, 10, 10, 3, pf="1500"),
        _st(2, 10, 5, 8, pf="1200"),
        _st(3, 20, 9, 4, pf="1450"),  # league 20 has one team
    ]
    result = seed_field(standings, field_per_league=2)
    assert {s.team_id for s in result} == {1, 2, 3}
    assert [s.seed for s in result] == [1, 2, 3]  # contiguous 1..K
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/bracket/test_engine.py -k seed_field -v`
Expected: FAIL — `ImportError: cannot import name 'seed_field'`.

- [ ] **Step 3: Implement `seed_field`**

Append to `backend/app/bracket/engine.py`:

```python
def _rank_key(s: TeamStanding) -> tuple[Fraction, Decimal, int]:
    games = s.wins + s.losses + s.ties
    win_pct = Fraction(s.wins * 2 + s.ties, games * 2) if games else Fraction(0)
    # Better teams sort first: higher win%, then higher points_for, then lower team_id.
    return (-win_pct, -s.points_for, s.team_id)


def seed_field(
    standings: Iterable[TeamStanding], field_per_league: int
) -> list[SeededTeam]:
    """Take the top ``field_per_league`` teams per league, pool them, and assign
    global seeds 1..K ordered by (win%, points_for, team_id). A league with fewer
    than ``field_per_league`` teams contributes all of them."""
    by_league: dict[int, list[TeamStanding]] = {}
    for standing in standings:
        by_league.setdefault(standing.league_id, []).append(standing)

    qualifiers: list[TeamStanding] = []
    for teams in by_league.values():
        qualifiers.extend(sorted(teams, key=_rank_key)[:field_per_league])

    qualifiers.sort(key=_rank_key)
    return [SeededTeam(team_id=s.team_id, seed=i + 1) for i, s in enumerate(qualifiers)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/bracket/test_engine.py -k seed_field -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add app/bracket/engine.py tests/bracket/test_engine.py
git commit -m "feat: add bracket seed_field (top-N per league, pooled global seeding)"
```

---

### Task 3: `generate_round`

**Files:**
- Modify: `backend/app/bracket/engine.py`, `backend/tests/bracket/test_engine.py`

**Interfaces:**
- Consumes: `RemainingTeam`, `RoundGame`, `RoundPlan` (Task 1).
- Produces: `generate_round(remaining: Iterable[RemainingTeam]) -> RoundPlan` — reseed by original seed, byes to the top seeds reducing the field to the largest power of two below `N` (when `N` isn't a power of two), remaining paired high-vs-low; raises `ValueError` for `N < 2`. Module-private helpers `_is_power_of_two`, `_largest_power_of_two_below`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/bracket/test_engine.py` (add `import pytest` at the top of the file if not present, and add `RemainingTeam, generate_round` to the `from app.bracket.engine import ...` line):

```python
def _rt(team_id, seed):
    return RemainingTeam(team_id=team_id, seed=seed)


def _teams(*seeds):
    # team_id == seed * 10 for easy identification in assertions
    return [_rt(seed * 10, seed) for seed in seeds]


def _pairs(plan):
    return [(g.high, g.low) for g in plan.games]


def test_generate_round_four_no_byes():
    plan = generate_round(_teams(1, 2, 3, 4))
    assert plan.byes == []
    assert _pairs(plan) == [(10, 40), (20, 30)]  # 1v4, 2v3


def test_generate_round_eight_no_byes():
    plan = generate_round(_teams(1, 2, 3, 4, 5, 6, 7, 8))
    assert plan.byes == []
    assert _pairs(plan) == [(10, 80), (20, 70), (30, 60), (40, 50)]


def test_generate_round_two():
    plan = generate_round(_teams(1, 2))
    assert plan.byes == []
    assert _pairs(plan) == [(10, 20)]


def test_generate_round_six_byes_top_two():
    plan = generate_round(_teams(1, 2, 3, 4, 5, 6))
    assert plan.byes == [10, 20]  # seeds 1,2 bye
    assert _pairs(plan) == [(30, 60), (40, 50)]  # 3v6, 4v5


def test_generate_round_five_byes_top_three():
    plan = generate_round(_teams(1, 2, 3, 4, 5))
    assert plan.byes == [10, 20, 30]
    assert _pairs(plan) == [(40, 50)]


def test_generate_round_seven_bye_top_one():
    plan = generate_round(_teams(1, 2, 3, 4, 5, 6, 7))
    assert plan.byes == [10]
    assert _pairs(plan) == [(20, 70), (30, 60), (40, 50)]


def test_generate_round_three_bye_top_one():
    plan = generate_round(_teams(1, 2, 3))
    assert plan.byes == [10]
    assert _pairs(plan) == [(20, 30)]


def test_generate_round_field_reduces_to_power_of_two():
    for n in range(2, 17):
        plan = generate_round(_teams(*range(1, n + 1)))
        field = len(plan.games) + len(plan.byes)
        assert field & (field - 1) == 0  # next field is a power of two
        assert field <= n and field * 2 > n  # it's the largest such <= n


def test_generate_round_input_order_independent():
    assert generate_round(_teams(6, 1, 4, 2, 5, 3)) == generate_round(_teams(1, 2, 3, 4, 5, 6))


def test_generate_round_requires_two():
    with pytest.raises(ValueError):
        generate_round(_teams(1))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/bracket/test_engine.py -k generate_round -v`
Expected: FAIL — `ImportError: cannot import name 'generate_round'`.

- [ ] **Step 3: Implement `generate_round`**

Append to `backend/app/bracket/engine.py`:

```python
def _is_power_of_two(n: int) -> bool:
    return n & (n - 1) == 0  # valid for n >= 1


def _largest_power_of_two_below(n: int) -> int:
    """Largest power of two strictly less than n (n >= 2)."""
    p = 1
    while p * 2 < n:
        p *= 2
    return p


def generate_round(remaining: Iterable[RemainingTeam]) -> RoundPlan:
    """Reseed the survivors by original seed and pair high-vs-low, giving byes to
    the top seeds when the field isn't a power of two (reducing it to the largest
    power of two below N). Requires at least 2 teams; the caller treats a single
    remaining team as the champion."""
    ordered = sorted(remaining, key=lambda t: t.seed)
    n = len(ordered)
    if n < 2:
        raise ValueError("generate_round requires at least 2 remaining teams")

    if _is_power_of_two(n):
        byes: list[int] = []
        playing = ordered
    else:
        p = _largest_power_of_two_below(n)
        b = 2 * p - n
        byes = [t.team_id for t in ordered[:b]]
        playing = ordered[b:]

    m = len(playing)
    games = [
        RoundGame(high=playing[i].team_id, low=playing[m - 1 - i].team_id)
        for i in range(m // 2)
    ]
    return RoundPlan(games=games, byes=byes)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/bracket/test_engine.py -k generate_round -v`
Expected: 10 passed.

- [ ] **Step 5: Run the whole engine suite + full suite**

Run: `uv run pytest tests/bracket/test_engine.py -v`
Expected: 18 passed (3 resolve + 5 seed + 10 round).

Run: `uv run pytest`
Expected: full suite green (previous total + 18), no new warnings.

- [ ] **Step 6: Commit**

```bash
git add app/bracket/engine.py tests/bracket/test_engine.py
git commit -m "feat: add bracket generate_round (reseeded pairings + byes to top seeds)"
```

---

## Verification (whole branch)

- `uv run pytest tests/bracket/test_engine.py -v` — 18 passed.
- `uv run pytest` — full suite green, only the known baseline warnings; the bracket tests are pure and add none.
- Spot-check the engine is import-clean of any ORM/DB: `app/bracket/engine.py` imports only `collections.abc`, `dataclasses`, `decimal`, `fractions`.
