# Sleeper Client & Scoring Engine — Design (Plan 2)

**Date:** 2026-06-24
**Status:** Design approved; ready for implementation planning
**Builds on:** Plan 1 (Foundation & Data Model) — merged to `main`

## Summary

Plan 2 adds the two pure, database-free units the rest of the platform depends
on: a **Sleeper API client** that fetches and parses the data we need from
Sleeper's public read API, and a **scoring engine** that turns raw player stat
lines into fantasy points using a data-driven ruleset.

Both units are intentionally free of any database access. The client returns
parsed Pydantic objects; the engine takes plain dicts and returns `Decimal`.
Persistence (writing `Player`/`PlayerStatCache`/`weekly_score` rows), the
hybrid scoring/mismatch logic, and game-window scheduling are deferred to
Plan 3's sync service, which wires these two units to the database.

## Goals

- Provide a typed, tested `SleeperClient` covering every Sleeper endpoint the
  platform needs, with retry/backoff and an in-memory cache for the large player
  dump.
- Provide a pure, fully data-driven `scoring_engine` that computes points as
  `stat_value × ruleset_multiplier`, mirroring exactly how Sleeper scores.
- Ship a default full-PPR ruleset (in Sleeper `scoring_settings` format) as the
  starting point, tweakable per season.

## Non-Goals (YAGNI / deferred to later plans)

- Any database writes or reads (Plan 3 sync service).
- Hybrid scoring comparison, mismatch tolerance/flagging (Plan 3).
- Game-window-aware scheduling and polling cadence (Plan 3).
- Scoring-settings validation of a league against the platform ruleset (Plan 3).
- Disk/persistent caching (in-memory only this phase).
- Seeding a `ScoringRuleset` DB row (admin/Plan 3).

## Key Decisions

| Decision | Choice |
|---|---|
| Scoring system | Likely full-PPR, but must stay flexible and may change between seasons. Engine is fully data-driven; no hardcoded values. |
| Ruleset format | Mirror Sleeper's `scoring_settings`: a flat `dict[str, float]` (stat key → per-unit multiplier). Guarantees we can represent exactly what leagues use; makes recompute and Plan 3 validation trivial. |
| Client scope | Pure client, in-memory cache only. No DB writes. Persistence + scheduling deferred to Plan 3. |
| Response parsing | Pydantic models with `extra="ignore"` for the fields we use; `scoring_settings` kept as raw `dict[str, float]` (it is our ruleset format). |
| Async | Client is async (`httpx.AsyncClient`); tests use `pytest-asyncio`. |
| Precision | `Decimal` throughout; round each player's total to 2 decimals (half-up), then sum player totals for a lineup. |

## Architecture & File Structure

Two new packages under `backend/app/`, plus tests:

```
backend/app/
  sleeper/
    __init__.py
    client.py        # SleeperClient: async httpx wrapper, retry/backoff, player-dump cache
    models.py        # Pydantic response models
    errors.py        # SleeperError, SleeperNotFound, SleeperUnavailable
  scoring/
    __init__.py
    engine.py        # pure scoring functions
    rulesets.py      # DEFAULT_PPR ruleset constant (Sleeper scoring_settings format)
backend/tests/
  sleeper/
    __init__.py
    test_client.py
    fixtures/        # captured Sleeper JSON responses
  scoring/
    __init__.py
    test_engine.py
    test_rulesets.py
```

Neither package imports from `app.db` or `app.models`. They are standalone and
unit-tested without a database.

## Component: Sleeper Client

`SleeperClient` wraps `https://api.sleeper.app/v1` using `httpx.AsyncClient`
(no auth). One method per needed endpoint, each returning a parsed Pydantic
model or collection.

| Method | Endpoint | Returns |
|---|---|---|
| `get_nfl_state()` | `/state/nfl` | `NflState` (season, week, season_type, leg) |
| `get_league(league_id)` | `/league/{id}` | `SleeperLeague` (name, `scoring_settings: dict[str,float]`, `roster_positions`, status, `previous_league_id`) |
| `get_league_users(league_id)` | `/league/{id}/users` | `list[SleeperUser]` (user_id, display_name, `is_commissioner`) |
| `get_league_rosters(league_id)` | `/league/{id}/rosters` | `list[SleeperRoster]` (roster_id, owner_id, settings: wins/losses/ties/fpts/fpts_against) |
| `get_matchups(league_id, week)` | `/league/{id}/matchups/{week}` | `list[SleeperMatchup]` (roster_id, matchup_id, points, `players`, `starters`, `players_points`) |
| `get_players()` | `/players/nfl` | `dict[str, SleeperPlayer]`, cached |
| `get_weekly_stats(season, week, season_type="regular")` | `/stats/nfl/{type}/{season}/{week}` | `dict[str, dict[str, float]]` — raw per-player stat lines |

**Commissioner identity:** derived from the league-users payload's `is_owner`
flag, surfaced as `SleeperUser.is_commissioner`.

**`/stats/nfl/...` defensiveness:** this endpoint is semi-documented; its
per-player stat map is treated defensively (missing keys simply absent). The
scoring engine ignores unknown keys, so this is safe.

**Caching:** only `get_players()` is cached — a single in-memory entry with a
TTL (default 24h) guarded by an `asyncio.Lock` so concurrent callers do not all
fetch the ~5MB dump. The cache uses an injectable clock for testability. All
other endpoints fetch fresh.

**Retry/backoff:** a wrapper retries on `429` and `5xx` and connection errors
with exponential backoff (configurable `max_retries`, base delay), honoring a
`Retry-After` header when present. `404` does not retry. The sleep function is
injectable so tests do not wait on real time. Per-request timeout default ~15s.

**Errors (`errors.py`):**
- `SleeperError` — base.
- `SleeperNotFound` — raised on `404` (e.g., bad league id); no retry.
- `SleeperUnavailable` — raised when retries are exhausted (persistent `5xx`/
  connection failure).
Callers receive typed errors, never raw `httpx` exceptions.

**Construction/lifecycle:** `SleeperClient(base_url=..., timeout=...,
max_retries=..., players_cache_ttl=..., transport=None, sleep=..., clock=...)`
with sensible defaults; accepts an injected `httpx.AsyncClient` or transport so
tests pass a `MockTransport`. Supports `async with` and an explicit `aclose()`.

## Component: Scoring Engine

Pure functions in `engine.py` — no I/O, no DB, no Sleeper imports. All math in
`Decimal`.

```python
def score_stat_line(stats: Mapping[str, float], ruleset: Mapping[str, float]) -> Decimal:
    """Sum stat_value * multiplier over keys present in BOTH maps, rounded to
    2 decimals (ROUND_HALF_UP). Keys in only one map contribute nothing."""

def score_players(
    player_stats: Mapping[str, Mapping[str, float]],
    ruleset: Mapping[str, float],
) -> dict[str, Decimal]:
    """player_id -> points, applying score_stat_line to each."""

def sum_points(
    player_ids: Iterable[str],
    player_points: Mapping[str, Decimal],
) -> Decimal:
    """Aggregate a subset of already-scored players (e.g. starters, or bench).
    Missing player_ids contribute Decimal('0')."""
```

- `score_stat_line` implements `sum(Decimal(str(stats[k])) * Decimal(str(ruleset[k]))
  for k in stats.keys() & ruleset.keys())` then quantizes to `0.01`
  (`ROUND_HALF_UP`). This is exactly Sleeper's method: per-unit multiplier ×
  stat value, summed.
- Precision: round each player's total to 2 decimals (matching Sleeper's
  per-player rounding), then sum player totals for a lineup. The mismatch
  *tolerance* for the hybrid check is Plan 3's concern, not the engine's.
- Who is a "starter" comes from Sleeper's matchup `starters`/`players` lists in
  Plan 3; the engine only sums what it is handed via `sum_points`. Starter/bench
  logic stays out of the pure engine.

**Default ruleset (`rulesets.py`):** `DEFAULT_PPR: dict[str, float]` in Sleeper
`scoring_settings` format — standard full-PPR core keys (e.g. `pass_yd: 0.04`,
`pass_td: 4`, `pass_int: -2`, `rush_yd: 0.1`, `rush_td: 6`, `rec: 1`,
`rec_yd: 0.1`, `rec_td: 6`, `fum_lost: -2`, plus standard kicking and DST keys).
A plain Python constant — not a DB write. Used as engine test fixtures now and
available for seeding a `ScoringRuleset` row later. Fully tweakable; the engine
is data-driven.

## Testing Strategy

Test-driven throughout. New dev dependency: `pytest-asyncio` (httpx already
present; no new runtime deps — Pydantic comes via pydantic-settings).

**Scoring engine (`tests/scoring/`):**
- `score_stat_line`: realistic PPR WR line, a QB line, negatives (INT/fumble),
  empty stats → `Decimal('0.00')`, all asserting exact expected `Decimal`.
- Disjoint keys: stat keys absent from ruleset and ruleset keys absent from
  stats both contribute 0.
- Rounding: a line that exercises half-up rounding at the 2nd decimal.
- `score_players` over several players; `sum_points` for a starter subset and a
  bench subset, including a missing player_id contributing 0.
- `test_rulesets.py`: `DEFAULT_PPR` is a flat `dict[str, float]`, includes the
  expected core keys, and produces a sane score through the engine.

**Sleeper client (`tests/sleeper/`) — no live network calls, ever:**
- Recorded JSON fixtures under `tests/sleeper/fixtures/`; an `httpx.MockTransport`
  serves them. Each method parses into the right Pydantic model exposing the
  fields we depend on (`get_league` → `scoring_settings: dict[str,float]`;
  `get_matchups` → `starters`/`players`/`players_points`; `get_league_users` →
  `is_commissioner`).
- Caching: `get_players()` twice → one transport hit; after TTL expiry (via the
  injected clock) → refetch.
- Retry/backoff (injected sleep, no real waiting): `429` then `200` → success;
  `500`×(max+1) → `SleeperUnavailable`; `404` → `SleeperNotFound` with no retry.
- Concurrency: two concurrent `get_players()` calls → one transport hit (the
  `asyncio.Lock` holds).

## Open Items

- Exact `DEFAULT_PPR` values (kicking/DST specifics) finalized during
  implementation; full-PPR offensive core is fixed above. Tweakable later.
- The enum name-vs-value representation decision from Plan 1's review is
  unrelated to Plan 2 and remains tracked for the API plan.
