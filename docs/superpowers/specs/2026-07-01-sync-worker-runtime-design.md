# Sync Worker Runtime (Plan 3b) — Design

## Summary

The sync worker is the long-running service that **drives** the Plan 3a
`SyncService` on an NFL-game-window-aware cadence. It owns scheduling and
cross-league orchestration: each cycle it asks Sleeper for the current NFL
state, resolves the active season, and syncs every league's current week,
polling frequently during game windows and backing off otherwise. It adds no
new sync logic — `SyncService` already does the Sleeper→DB work; this plan is
the loop, the schedule policy, the cross-league orchestration, error isolation,
the entrypoint, and deployment.

## Goals

- Keep synced data fresh during games (poll every few minutes in game windows)
  and be a polite Sleeper consumer otherwise (a few times daily; long idle
  off-season).
- Drive `SyncService.sync_week` across all leagues of the active season each
  cycle, isolating per-league failures.
- Run `sync_players()` about once a day.
- Be structured so the scheduling logic and one cycle are unit-testable without
  a real long-running loop.
- Deploy as a separate Railway service off the same repo.

## Non-Goals

- No new Sleeper→DB sync logic (that is Plan 3a).
- No `sync_league_setup` / "sync now" — league entry and manual sync are
  on-demand, API-triggered actions owned by the API/auth plan. The worker only
  drives the recurring in-season sync of leagues that already exist.
- No admin mismatch-review queue (API/frontend plan). The worker only *logs*
  mismatch counts.
- No fix for the DEF/K `mismatch_flag` over-firing — deferred until the review
  queue is built and real data exists (see Open Items). The worker surfaces the
  signal via logging.
- No live per-game schedule feed — the game windows are a static weekly table.

## Architecture

New `app/worker/` package, decomposed so the untestable part (the loop) is thin
and the logic is pure or single-pass:

- **`schedule.py`** — pure scheduling policy. No I/O.
- **`cycle.py`** — one sync pass. Async; touches Sleeper (mockable) + DB.
- **`runner.py`** — the loop: run a cycle, sleep for the computed interval,
  repeat. Clock and sleep injected.
- **`__main__.py`** — entrypoint wiring real dependencies.

Dependency direction: worker depends on `app.sync`, `app.sleeper`,
`app.scoring`, `app.models`, `app.config`; nothing depends on the worker.

### Component boundaries

- `schedule.poll_interval(now, nfl_state, season_active) -> float` — given the
  current timezone-aware datetime, the `NflState`, and whether the cycle found
  an active season, return seconds until the next poll. Consults a static weekly
  game-window table. Pure, deterministic.
- `cycle.run_cycle(client, session_factory, clock, players_state) -> CycleResult`
  — one pass: fetch NFL state, resolve the active season, sync each league's
  week, maybe sync players. Returns the fetched `NflState` and a `season_active`
  flag so the runner can pick the next interval without a second Sleeper call.
- `runner.run(client, session_factory, clock, sleep, should_continue)` — the
  loop; injectable clock/sleep/stop predicate for tests.
- `__main__` — build `SleeperClient` and a `sessionmaker`, then call `runner.run`
  with real `time`/`asyncio.sleep` and an always-true continue predicate.

## Scheduler Policy

`poll_interval(now, nfl_state, season_active)`:

1. If `not season_active` (the cycle found no active season) or
   `nfl_state.season_type != "regular"` → return `worker_interval_idle` (long).
   All fantasy-relevant play — including the cross-league super-bracket, which
   runs during NFL regular-season weeks — happens while `season_type` is
   `regular`; NFL `post`/`pre`/`off` mean nothing for us to sync.
2. Else compute `now` in `America/New_York` (via `zoneinfo`). If it falls inside
   a game window for that weekday → return `worker_interval_active` (short).
3. Else (in-season, outside a window) → return `worker_interval_in_season`
   (medium).

The window table is a static structure mapping weekday → list of
`(start_time, end_time)` in ET, covering:

- Thursday night (~20:00–23:59)
- Sunday (~13:00–23:59, the main slate through SNF)
- Monday night (~20:00–23:59)
- Saturday late-season block (~13:00–23:59)

Being a few minutes early/late is harmless — round finalization is a manual
admin action, so the worker only needs to keep scores *fresh*, not
frame-accurate. The table is a plain constant, trivial to amend for holiday or
international slots.

## Cycle Orchestration

`run_cycle`:

1. `nfl_state = await client.get_nfl_state()`; derive `year = int(nfl_state.season)`,
   `week = nfl_state.week`.
2. Load the `Season` for `year` in a short read. If none, or status is `setup`
   or `complete` → return an idle `CycleResult` (nothing synced).
3. Resolve the ruleset: the season's `scoring_ruleset.rules` if set, else
   `DEFAULT_PPR`.
4. For each `League` in the season (sequential): open a transaction
   (`with session_factory.begin() as session:`), construct
   `SyncService(client, session, season, ruleset)`, `await sync_week(league.id,
   week)`. Catch any exception, log it with the league id, and continue to the
   next league. Accumulate scored/skipped/mismatch counts for logging.
5. If the players cache is due (last successful `sync_players` older than
   `worker_players_sync_hours`, tracked in an in-memory `players_state`), run
   `sync_players()` in its own transaction and update the timestamp.
6. Return a `CycleResult` (the fetched `NflState`, a `season_active` flag, the
   active season/week when present, per-league counts, and errors) for the
   runner to log and to derive the next poll interval from.

The runner computes the next interval as `poll_interval(now, result.nfl_state,
result.season_active)` — reusing the state the cycle already fetched, so there
is exactly one `get_nfl_state` call per tick.

### Transaction & error model

- One transaction per league per cycle. `SyncService` flushes; the
  `session_factory.begin()` block commits on success, rolls back on exception.
  This matches the 3a flush-not-commit contract.
- Per-league isolation: a `SleeperError`/`SyncError`/unexpected exception for one
  league is logged and skipped; the cycle continues.
- A failing cycle never kills the loop: `runner` wraps `run_cycle` so an
  unexpected cycle-level error is logged and the loop waits for the next tick.
- Accepted tradeoff: because `sync_week` pulls-then-writes, the per-league
  transaction is open during its Sleeper HTTP calls. Acceptable at this scale
  (few leagues, low volume); not worth splitting pull/persist in 3a.
- Sequential league processing — a polite Sleeper consumer; the client already
  retries/backs off. No concurrency pool (YAGNI).

## Config

Add to `app/config.py` `Settings` (all overridable via env):

- `worker_interval_active: float = 180.0` — seconds between polls in a game window.
- `worker_interval_in_season: float = 1800.0` — seconds between polls in-season, off-window.
- `worker_interval_idle: float = 21600.0` — seconds between polls off-season.
- `worker_players_sync_hours: float = 24.0` — minimum hours between `sync_players` runs.

## Entrypoint & Deployment

- `python -m app.worker` runs the loop.
- Add `worker: python -m app.worker` to the `Procfile`.
- The worker is deployed as a **separate Railway service** off the same repo,
  with start command `python -m app.worker`.
- The **web service owns migrations** (its existing
  `preDeployCommand: alembic upgrade head`). The worker never runs alembic,
  avoiding concurrent-migration races.

## Observability

Standard-library `logging`. Per cycle the worker logs: the active season/week
(or "idle" when no active season), and per league the scored count, skipped
count, and **mismatch count** (the deferred DEF/K signal). Caught per-league
errors log at `warning`/`error` with the league id and exception. This gives
the data needed to settle DEF/K handling before the review queue is built.

## Testing Strategy

- `schedule.poll_interval` — pure unit tests over fixed timezone-aware clocks:
  `season_active=False` → idle; off-season (`season_type != "regular"`) → idle;
  in-season inside each weekday window → active; in-season outside windows →
  in-season interval; boundary times.
- `cycle.run_cycle` — with a mock `SleeperClient` (fixture `NflState` + matchup/
  roster/stats payloads) and a real Postgres session factory: a seeded season
  with two leagues gets both weeks synced; one league raising still lets the
  other sync (isolation); no active season → idle result, nothing written; the
  `sync_players` daily gate fires only when due.
- `runner.run` — injected fake clock/sleep and a `should_continue` that stops
  after N iterations: asserts `run_cycle` is called each iteration and the slept
  interval matches `poll_interval`; a cycle raising does not stop the loop.
- No live Sleeper calls anywhere; Postgres via the existing test fixtures.

## Open Items (deferred)

- DEF/K `mismatch_flag` over-firing: settle when the admin review queue is built
  and real worker data exists. Worker logs mismatch counts to inform it.
- Live per-game schedule feed (vs. the static window table): only if the static
  table proves too coarse in practice.
- Holiday/international game slots: amend the static window table as needed.
