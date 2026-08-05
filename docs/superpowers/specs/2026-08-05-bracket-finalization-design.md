# Round Finalization + Advancement + Worker Live Scores (API-4c) — Design

**Date:** 2026-08-05
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Make the super-bracket actually play out. After Monday night, the super-admin
finalizes the current round: each matchup is decided by the platform's recompute,
survivors advance (the next round is generated via the 4a engine) or the bracket
completes. Meanwhile the sync worker keeps the in-progress round's matchup scores
live during games so the public bracket updates in near-real-time.

This is the last of the three decomposed **API-4 (super-bracket)** cycles:

- **API-4a (merged)** — `bracket_engine` pure logic.
- **API-4b (merged)** — generation + approval + public read.
- **API-4c (this spec)** — round finalization + advancement + worker live scores.

## Goals

- `finalize_current_round(session, bracket)` — a pure-DB orchestrator that decides
  the current round from already-synced `WeeklyScore` data, locks those scores,
  and advances the bracket (next round via `generate_round`, or COMPLETE).
- A super-admin `finalize-round` endpoint (DB-only, no Sleeper call).
- `update_bracket_live_scores(session, season_id, week)` — the worker copies the
  in-progress round's live scores into its matchups each cycle.

## Decisions (settled)

- **Matchups are decided by `WeeklyScore.recomputed_points`** (the platform's
  independent recompute, the fairness source), with `bench_points` as the
  tiebreaker, then better original seed — exactly `resolve_matchup`'s contract.
- **Finalize is DB-only**: it reads `WeeklyScore` rows the worker (or a manual
  3c "sync now") already populated. It does NOT call Sleeper. Missing scores →
  409 (sync first).
- **Current round auto-detected** (lowest round with an unfinalized non-bye
  matchup) — no round parameter.
- **Champion is derived** from the final matchup's `winner_team_id`; finalize
  sets `bracket.status = COMPLETE` but writes no explicit champion field and no
  `Team.league_finish`.
- **One-way**: no un-finalize / undo (matches "finalize after Monday night
  sidesteps Tue/Wed corrections").

## Non-Goals (this cycle)

- No Sleeper I/O in the finalize path (that's the worker / 3c sync-now).
- No re-finalization, no manual score overrides, no bracket reset.
- No model changes, no migration.
- No history/hall-of-fame aggregation (champions are derived on read later).

## Existing State (grounding)

- `WeeklyScore(team_id, week, sleeper_points, recomputed_points: Decimal|None,
  bench_points: Decimal|None, mismatch_flag, is_final)`; unique `(team_id, week)`.
  The worker's `SyncService.sync_week` populates `recomputed_points` /
  `bench_points` each cycle.
- `BracketMatchup(bracket_id, round, nfl_week, team_a_id, team_b_id,
  team_a_score, team_b_score, winner_team_id, is_finalized, bye)`;
  `BracketSeed(bracket_id, team_id, seed)` (the `team_id → seed` map);
  `Bracket(season_id, size, status: PENDING|ACTIVE|COMPLETE)`.
- 4a engine (pure): `resolve_matchup(MatchupSide{team_id, seed, starter_points,
  bench_points}, ...) -> team_id`; `generate_round(remaining: [RemainingTeam
  {team_id, seed}]) -> RoundPlan{games: [RoundGame{high, low}], byes: [team_id]}`
  (requires N>=2). See [[bracket-engine-interface]].
- 4b left the data 4c-ready ([[api4b-followups]]): round-1 matchups exist, bye
  rows carry `winner_team_id` + `is_finalized=True`, `size` may be
  non-power-of-two, round 1's `nfl_week = nfl_playoff_weeks[0]`. The 4b admin
  router (`app/api/admin/bracket.py`) has module helpers `_get_bracket(db,
  season_id)` and `_bracket_response(db, bracket)` and returns
  `BracketAdminResponse`.
- Worker `run_cycle` (`app/worker/cycle.py`): resolves the active season +
  `league_ids` + `week` from `nfl_state`, syncs each league via
  `SyncService.sync_week` in its own `session_factory.begin()` block, then syncs
  players. Idle when the season status is SETUP/COMPLETE.

## Finalization Service (`app/bracket/finalization.py`)

Errors (mapped by the endpoint): `class FinalizeError(Exception)` base, with
`ScoresNotSynced`, `NothingToFinalize`, `NotEnoughPlayoffWeeks` subclasses.

`finalize_current_round(session: Session, bracket: Bracket) -> Bracket`

1. Load the bracket's matchups (ordered by `round`, `id`) and the `team_id →
   seed` map from `BracketSeed`.
2. **Current round** = the lowest `round` among matchups with `is_finalized ==
   False`. If there are none → raise `NothingToFinalize`.
3. Let `round_matchups` = all matchups in that round; `games` = the non-bye ones.
   `week = round_matchups[0].nfl_week`. `survivor_count = len(round_matchups)`
   (each matchup yields exactly one winner).
4. **Up-front guards (before any mutation):**
   - For every game's `team_a_id`/`team_b_id`: a `WeeklyScore` for `week` must
     exist with non-null `recomputed_points` → else raise
     `ScoresNotSynced(f"week {week}")`.
   - If `survivor_count > 1` (a next round will be generated) and
     `len(season.nfl_playoff_weeks) < current_round + 1` → raise
     `NotEnoughPlayoffWeeks`.
5. **Resolve + lock** each game: build `MatchupSide` per side (`starter_points =
   recomputed_points`, `bench_points = bench_points or Decimal("0")`, `seed` from
   the map); `winner = resolve_matchup(a, b)`; set `team_a_score` /
   `team_b_score` (recomputed), `winner_team_id`, `is_finalized=True`; set each
   side's `WeeklyScore.is_final = True`.
6. **Advance:** `survivors = [RemainingTeam(m.winner_team_id, seed_map[
   m.winner_team_id]) for m in round_matchups]`.
   - If `len(survivors) == 1` → `bracket.status = BracketStatus.COMPLETE`.
   - Else `plan = generate_round(survivors)`; `next_week =
     season.nfl_playoff_weeks[current_round]` (0-indexed: round `n` uses index
     `n-1`, so the next round `n+1` uses index `n` = `current_round`). Create
     round `current_round + 1` matchups: games → `team_a_id=game.high,
     team_b_id=game.low, bye=False, is_finalized=False`; byes → `team_a_id=bye,
     team_b_id=None, bye=True, winner_team_id=bye, is_finalized=True`.
   Bracket stays ACTIVE.
7. `session.flush()`; return `bracket`. The service flushes but does not commit.

`update_bracket_live_scores(session: Session, season_id: int, week: int) -> int`

- Find the season's **ACTIVE** bracket (none → return 0).
- For its matchups with `nfl_week == week`, `is_finalized == False`, `bye ==
  False`: set `team_a_score` / `team_b_score` from each team's `WeeklyScore.
  recomputed_points` for `week` when present (leave null if not yet synced).
  Never touch `winner_team_id` / `is_finalized`. Return the number of matchups
  updated. Idempotent (safe to run every cycle).

## Finalize Endpoint (extends `app/api/admin/bracket.py`, router-level `require_super_admin`)

`POST /admin/seasons/{season_id}/bracket/finalize-round`

- `_get_bracket(db, season_id)` → 404 if none.
- Require `bracket.status is BracketStatus.ACTIVE` → else 409 (PENDING = not
  approved; COMPLETE = done).
- `try: finalize_current_round(db, bracket)` mapping `ScoresNotSynced` /
  `NothingToFinalize` → 409, `NotEnoughPlayoffWeeks` → 422.
- `db.commit()`; return `_bracket_response(db, bracket)` (`BracketAdminResponse`).

## Worker Integration (`app/worker/cycle.py`)

After the per-league sync loop (and before/around the players sync), add a
guarded block:

```python
try:
    with session_factory.begin() as session:
        update_bracket_live_scores(session, season_id, week)
except Exception:
    logger.exception("bracket live-score update failed")
```

This runs every cycle during the active season, so the public bracket reflects
live scores; it is a no-op when there is no ACTIVE bracket or no current-week
matchups. `CycleResult` may optionally gain a count, but that is not required.

## Schemas & Error Mapping

- Reuse `BracketAdminResponse` (4b) for the finalize response.
- `401` no token / `403` non-super-admin (router-level gate).
- `404` no bracket; `409` bracket not ACTIVE, scores not synced, or nothing to
  finalize; `422` not enough playoff weeks configured for the next round.

## Testing Strategy

Test-driven, Postgres-backed.

- **`tests/bracket/test_finalization.py`** (service, DB, no HTTP): seed an ACTIVE
  bracket (via the 4b generator or direct rows) plus `WeeklyScore` rows, then:
  finalize a 4-team round 1 → winners set from recomputed_points, losers' scores
  set, `WeeklyScore.is_final` locked, round 2 generated with the next playoff
  week; a bench-points tiebreak decides an equal-starter game; finalizing the
  final round → `bracket.status == COMPLETE`, no next round; `ScoresNotSynced`
  when a team's week score is missing/null; `NotEnoughPlayoffWeeks` when the
  season lacks a week for the next round; `NothingToFinalize` on a COMPLETE
  bracket; byes carry through as survivors. `update_bracket_live_scores` copies
  recomputed_points into current-week non-finalized matchups, skips finalized
  ones, and no-ops without an ACTIVE bracket.
- **`tests/api/admin/test_bracket.py`** (extend): finalize endpoint advances the
  round (200, response shows the new round); 409 when not ACTIVE (PENDING) and
  when scores aren't synced; 404 unknown bracket; 401/403 auth.
- **`tests/worker/`** (extend the cycle tests): after a cycle with an ACTIVE
  bracket and synced scores, the current-round matchups carry live scores; a
  failure in the live-score step doesn't abort the cycle.
- Full suite green; only the known baseline warnings.

## Files

- Create: `app/bracket/finalization.py`, `tests/bracket/test_finalization.py`.
- Modify: `app/api/admin/bracket.py` (finalize route), `app/worker/cycle.py`
  (call the updater), `tests/api/admin/test_bracket.py`, and the worker cycle
  tests.
- No model changes, no migration, no schema additions (reuse
  `BracketAdminResponse`).

## Cross-Cutting Requirement

Per [[admin-capabilities-need-ui]], the `finalize-round` endpoint owes a future
admin-UI "Finalize round" button — no raw API calls for real users.

## Constraints

- All commands from `backend/`. Tests: `uv run pytest ...`. Postgres required
  (test DB `insight2redraft_test`).
- Finalize is pure DB — no Sleeper I/O. The service flushes; the endpoint
  commits. All finalize guards are checked before any mutation (all-or-nothing).
- The pure engine (`app/bracket/engine.py`) is not modified.
- No new dependencies. Admin-only detail never leaks into public responses.
- Known warning baseline: PyJWT `InsecureKeyLengthWarning`,
  `StarletteDeprecationWarning`. Anything new is a problem.
