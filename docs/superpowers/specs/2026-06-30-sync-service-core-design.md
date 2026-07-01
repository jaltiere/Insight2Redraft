# Sync Service Core (Plan 3a) — Design

## Summary

`sync_service` is the orchestration layer that turns Sleeper data into persisted
platform state. It wires the existing `sleeper_client` (fetch) and
`scoring_engine` (pure recompute) into idempotent, atomic DB writes. This plan
(3a) covers the **core**: single-league and single-week sync operations, the
hybrid scoring/mismatch comparison, the league scoring-validation check, and
player/stat caching. It deliberately excludes the long-running worker runtime —
scheduling, NFL game-window cadence, and cross-league orchestration — which is a
separate follow-up plan (3b) that merely *drives* the operations defined here.

## Goals

- Persist Sleeper league config, users, and rosters into `league` + `team`.
- Persist weekly matchup results into `weekly_score` with both Sleeper points and
  an **independent** recompute, flagging divergence.
- Validate each league's Sleeper scoring settings against the platform ruleset.
- Cache raw weekly player stats (and optionally the player dump) for recompute
  and display.
- Be idempotent (safe to re-run) and atomic (a failed pull writes nothing).
- Be fully unit-testable against recorded fixtures + a real Postgres, with no
  live Sleeper calls and no long-running process.

## Non-Goals (3b / later)

- Scheduling, polling, NFL game-window awareness, backoff cadence.
- Cross-league orchestration (the "sync every league this week" loop).
- Scheduling of the `players/nfl` dump (the upsert *function* lives here; its
  cadence does not).
- Owner identity creation/mapping (an admin action; sync never touches it).
- Bracket seeding, round advancement, or resolution policy for flagged teams.

## Architecture & Boundaries

New package `app/sync/`:

- `service.py` — `SyncService`, the orchestration. Depends on `app.sleeper`
  (client + response models), `app.scoring` (engine + ruleset), and `app.models`
  (DB). Owns **no** scheduling, no cross-league loop, no game-window logic.
- `validation.py` — a pure scoring-diff function. No DB, no Sleeper.
- `errors.py` — `SyncError` for sync-level failures; `SleeperError` propagates
  untouched.

`SyncService` is constructed with an injected `SleeperClient`, a SQLAlchemy
`Session`, and the active `Season` (which carries the platform
`ScoringRuleset`). Dependency direction is one-way: sync depends on
client/engine/models; none of them depend on sync.

### Dependency rationale

Keeping `validation.py` pure (just dict-in, result-out) and `SyncService`
constructor-injected means: validation is trivially unit-tested in isolation,
and the orchestration is tested by feeding a `SleeperClient` backed by
`MockTransport` + recorded fixtures and asserting on rows written to the test
database. No business logic lives in the client; no scheduling lives in sync.

## Public Operations

Both operations are **idempotent** (re-running yields the same rows) and
**atomic** (one Sleeper pull → one DB transaction; on failure nothing is
committed and the error raises).

### `sync_league_setup(sleeper_league_id) -> LeagueSyncResult`

1. Pull league config, users, rosters from Sleeper.
2. Upsert `league` (natural key `season_id, sleeper_league_id`): `name`,
   `commish_sleeper_id`.
3. Run the scoring-validation check (see below); set `league.scoring_validated`.
4. Upsert `team` rows (natural key `league_id, sleeper_roster_id`): set
   `sleeper_user_id`, `wins`, `losses`, `ties`, `points_for`, `points_against`
   from the roster's settings. **Preserve any existing `owner_id`** — sync never
   writes or clears it.
5. Return `LeagueSyncResult`: the league id, `scoring_validated`, the validation
   `diffs`, and `commish_sleeper_id` (so a later layer can auto-grant League
   Admin).

Sync does **not** create `owner` rows or map Sleeper users to owners — that is an
admin action (Flow 1.4 of the platform design).

### `sync_week(league_id, week) -> WeekSyncResult`

1. Require an existing `league` row (else `SyncError`).
2. Pull `matchups/{week}` and the week's raw player stats.
3. Write `player_stat_cache` rows (natural key `sleeper_player_id, season,
   week`) for the players involved.
4. For each roster entry with **usable data** (see below):
   - Upsert `weekly_score` (natural key `team_id, week`): `sleeper_points` (the
     matchup's `points`), `recomputed_points`, `bench_points`, `mismatch_flag`.
   - Refresh the `team`'s `wins`/`losses`/`ties`/`points_for` from current
     roster settings.
5. Return `WeekSyncResult`: the list of teams scored and the list of **skipped
   rosters** (roster id + reason).

#### "Usable data" predicate

A roster's matchup entry is usable iff it has a **non-empty `starters` list** and
a **non-null `points` value**. Sleeper populates `points` only for weeks it
actually scores; a finished league's future weeks return null/empty. When a
roster is not usable, **no `weekly_score` row is written** (absence == "no
data") and the roster appears in the skipped list. This avoids fabricating a
misleading `0` or a stale carried-forward score for a real bracket participant.

The residual risk — Sleeper returning a genuine-looking number for a dead/stale
lineup — is surfaced via the skipped-roster report and later admin review. The
implementation plan must include a "league-ended"/empty-matchup fixture to
confirm Sleeper's actual payload shape for unscored weeks.

## Independent Recompute (the hybrid core)

For a team in a given week:

- `starters` and the roster's full `players` list come from the matchup entry.
- Raw per-player stat lines come from the weekly stats feed (cached into
  `player_stat_cache`).
- `recomputed_points = sum(score_stat_line(stats[p], platform_ruleset))` over
  **starters**.
- `bench_points = sum(score_stat_line(stats[p], platform_ruleset))` over
  `players − starters`.
- `sleeper_points` = the matchup entry's `points`.
- `mismatch_flag = abs(sleeper_points − recomputed_points) > Decimal("0.01")`.

Recompute always uses the **platform** ruleset, never the league's Sleeper
scoring settings. That is the point of the hybrid model: a mis-configured league
(one whose Sleeper scoring diverges from the platform) surfaces as per-week
mismatches rather than passing silently. All arithmetic stays `Decimal`,
half-up rounded, consistent with `scoring_engine`.

## Scoring Validation (`validation.py`)

Pure function:

```
validate_scoring(league_scoring_settings: dict, platform_ruleset: dict)
    -> ValidationResult
```

- Normalize: a category absent from either side is treated as `0`.
- Compare the union of category keys.
- `validated` is `True` only when **every** category matches exactly (including:
  the league has no extra non-zero scoring category absent from the ruleset,
  since that would change points).
- `diffs`: a list of `(category, league_value, platform_value)` for every
  mismatching category, always returned (powers the admin review screen).

By the league group's own rules every category should always match; a non-empty
`diffs`/`validated == False` therefore signals a real league configuration
problem to be surfaced to an admin, not absorbed.

## Player Dump (`sync_players`)

`sync_players() -> int` upserts the `player` table (`sleeper_player_id`
unique; `full_name`, `position`, `nfl_team`) from the `players/nfl` dump.
Included here so it is unit-tested with a fixture, but its **scheduling** (daily
cache) belongs to 3b. Recompute does not depend on it — recompute needs only
`player_stat_cache`.

## Errors

- `SyncError` — sync-level failures (e.g. `sync_week` called for a league row
  that does not exist).
- `SleeperError` — propagates untouched from the client; a failed pull aborts the
  transaction with nothing written.

## Testing Strategy

- `validation.py` — pure unit tests over hand-built dicts: exact match →
  `validated`; single-category diff; absent-normalized-to-0; extra non-zero
  league category → not validated.
- `service.py` — against a `SleeperClient` backed by `MockTransport` + recorded
  fixtures, writing to the Dockerized test Postgres. Assert:
  - `sync_league_setup` upserts `league` + `team`; idempotent (run twice → same
    rows); sets `scoring_validated` + diffs; **preserves** a pre-set
    `team.owner_id`.
  - `sync_week` writes `weekly_score` with correct `sleeper_points`,
    `recomputed_points`, `bench_points`; sets `mismatch_flag` per the epsilon;
    caches stats; idempotent.
  - **Skip-no-row path**: a "league-ended"/empty-matchup fixture yields no
    `weekly_score` rows and reports skipped rosters.
  - `sync_players` upserts `player` from a fixture; idempotent.
- No live Sleeper calls anywhere.

## Open Items (defer to 3b / later)

- Worker runtime: scheduling, NFL game-window cadence, backoff.
- Cross-league orchestration loop.
- `players/nfl` dump scheduling.
- Resolution policy for flagged/skipped playoff teams (bracket/admin plan).
- Confirming Sleeper's exact payload for a finished league's unscored weeks
  (handled via fixture during implementation).
