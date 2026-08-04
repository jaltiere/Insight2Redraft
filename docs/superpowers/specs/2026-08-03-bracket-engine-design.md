# Bracket Engine (API-4a) — Design

**Date:** 2026-08-03
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

The pure-logic core of the cross-league super-bracket: seeding the pooled
playoff field, generating each round's reseeded high-vs-low pairings (with byes),
and resolving a single matchup by the platform's tiebreak rules. No database, no
API, no I/O — three deterministic functions over plain frozen dataclasses,
mirroring `app/scoring/engine.py`. This is the fairness-critical foundation that
the later bracket cycles consume.

This is the first of the decomposed **API-4 (super-bracket)** cycles:

- **API-4a (this spec)** — `bracket_engine` pure logic.
- **API-4b (later)** — bracket generation + super-admin approval + public read
  (persist `Bracket`/`BracketSeed`/`BracketMatchup`, PENDING→ACTIVE).
- **API-4c (later)** — round finalization + advancement (lock scores, decide
  winners, generate the next round) + worker live matchup scores.

## Goals

- `seed_field` — from final regular-season standings, take the top N per league,
  pool, and assign global seeds `1..K` by a stable ranking key.
- `generate_round` — from the surviving teams (each carrying its original seed),
  reseed and produce high-vs-low pairings plus byes for top seeds when the field
  isn't a power of two.
- `resolve_matchup` — decide one matchup by starter points, then bench points,
  then better original seed.
- Exhaustive unit tests; the engine is where the bracket's fairness guarantees
  are proven.

## Non-Goals (this cycle)

- No persistence, no ORM, no API, no migration — pure functions only.
- No round-to-round orchestration (finalize → collect survivors → next round);
  that composition is DB-bound and belongs to API-4c. 4a supplies the primitives
  it will call.
- No wildcard/at-large berths. Qualification is strictly top-N per league (every
  league represented). The `QualifiedVia` enum's `WILDCARD` value stays unused
  for now; the engine emits AUTO-equivalent seeds only (it does not set
  `qualified_via` at all — that's a persistence concern).
- No champion detection inside `generate_round` (its precondition is `N >= 2`);
  the caller treats "one team remaining" as the champion.

## Existing State (grounding)

- Models already exist (`app/models/bracket.py`, from Plan 1): `Bracket(season_id
  unique, size, status: PENDING|ACTIVE|COMPLETE)`, `BracketSeed(bracket_id,
  team_id, seed, qualified_via: AUTO|WILDCARD)` unique `(bracket_id, seed)` and
  `(bracket_id, team_id)`, `BracketMatchup(bracket_id, round, nfl_week,
  team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id,
  is_finalized, bye)`. 4a does not touch them; 4b/4c persist into them.
- `Team` carries `wins, losses, ties, points_for` (final standings) — the
  seeding input. `WeeklyScore` carries `recomputed_points` (starter points),
  `bench_points`, `is_final` — the matchup-resolution inputs 4c will feed in.
- `Season.playoff_field_per_league` is the top-N value.
- Convention to mirror: `app/scoring/engine.py` — pure module-level functions,
  `Decimal` for points, plain `Mapping`/dataclass inputs, no side effects.

## Module

New package `app/bracket/` with `engine.py`. Data types (all
`@dataclass(frozen=True)`):

```python
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
    seed: int            # 1..K, 1 = best

@dataclass(frozen=True)
class RemainingTeam:
    team_id: int
    seed: int            # ORIGINAL seed, carried every round

@dataclass(frozen=True)
class RoundGame:
    high: int            # team_id of the better (lower-numbered) original seed
    low: int             # team_id of the worse original seed

@dataclass(frozen=True)
class RoundPlan:
    games: list[RoundGame]
    byes: list[int]      # team_ids of top seeds receiving a bye

@dataclass(frozen=True)
class MatchupSide:
    team_id: int
    seed: int
    starter_points: Decimal
    bench_points: Decimal
```

## Functions

### `seed_field(standings: Iterable[TeamStanding], field_per_league: int) -> list[SeededTeam]`

1. Group `standings` by `league_id`.
2. Within each league, sort by the **ranking key** and take the top
   `field_per_league` (a league with fewer teams contributes all of them).
3. Pool all qualifiers and sort by the same key.
4. Assign seeds `1..K` in that order; return `list[SeededTeam]`.

**Ranking key** (descending "better first"):
`win_pct` = `(wins + ties/2) / games` where `games = wins + losses + ties`
(0 games → `win_pct = 0`); then `points_for`; then `team_id` **ascending** as a
deterministic final fallback so seeding is always stable. Concretely, sort by the
tuple `(-win_pct, -points_for, team_id)`. `win_pct` is computed with `Decimal`/
exact rational comparison (no float rounding surprises — e.g. compare
`(wins*2 + ties) / (games*2)` or use `Fraction`).

### `generate_round(remaining: Iterable[RemainingTeam]) -> RoundPlan`

Precondition: `len(remaining) >= 2`. Reseed by original seed and pair
high-vs-low, byes to the top seeds when the field isn't a power of two.

1. Sort `remaining` by `seed` ascending → `s[0..N-1]`.
2. If `N` is a power of two: `byes = []`, pair `s[i]` with `s[N-1-i]` for
   `i in 0..N/2-1` → `high = s[i]`, `low = s[N-1-i]`.
3. Otherwise: let `P` = the largest power of two **strictly less than** `N`;
   `b = 2P - N`. The top `b` seeds `s[0..b-1]` get byes; the remaining
   `s[b..N-1]` (that's `N-b = 2(N-P)` teams) pair high-vs-low
   (`s[b+i]` vs `s[N-1-i]` for `i in 0..(N-P)-1`).
4. Return `RoundPlan(games, byes)`. Winners (`N-P`) + byes (`2P-N`) = `P`, so the
   next field is always a power of two and no later round has byes.

Example `N=6`: `P=4`, `b=2` → byes `[s0, s1]`; games `s2 vs s5`, `s3 vs s4`.

### `resolve_matchup(a: MatchupSide, b: MatchupSide) -> int`

Return the winning `team_id`:
1. Higher `starter_points` wins.
2. Tie → higher `bench_points`.
3. Still tied → better original seed (lower `seed` number).

Original seeds are unique within a bracket, so step 3 always decides; the
function never returns ambiguously.

## Testing Strategy

Test-driven, pure unit tests in `tests/bracket/test_engine.py` (no DB, no
fixtures beyond constructing dataclasses).

- **`seed_field`**: top-N cut within a league; pooling across leagues; win%
  ordering with ties counted as half (a team with more ties but equal wins
  ranks correctly); `points_for` breaks equal records; `team_id` breaks equal
  record **and** points_for (stability); a league with fewer than N teams
  contributes all; seeds are contiguous `1..K`.
- **`generate_round`**: powers of two `N in {2, 4, 8}` → no byes, correct
  high-vs-low pairs; non-powers `N in {3, 5, 6, 7}` → correct bye **count**,
  byes go to the **top** seeds, remaining teams paired high-vs-low, and
  winners+byes form the next power of two; ordering independent of input order.
- **`resolve_matchup`**: higher starter points wins; equal starters → higher
  bench wins; equal starters and bench → better seed wins; `Decimal` values
  compared exactly.

## Files

- Create: `app/bracket/__init__.py`, `app/bracket/engine.py`,
  `tests/bracket/__init__.py`, `tests/bracket/test_engine.py`.
- No model changes, no API wiring, no migration.

## Constraints

- All commands from `backend/`. Tests: `uv run pytest ...`.
- Pure functions only — no DB, no network, no global state. `Decimal` for all
  points; exact/rational comparison for win%.
- No new dependencies (`fractions.Fraction` / `decimal.Decimal` are stdlib).
- Known warning baseline: PyJWT `InsecureKeyLengthWarning`,
  `StarletteDeprecationWarning`. Anything new is a problem.
