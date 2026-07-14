# Public Read Endpoints (API-2) — Design

## Summary

API-2 is the public, unauthenticated read layer for the Insight2Redraft API:
season/standings, league/team, and basic owner-profile endpoints that back the
regular-season public site. It reads only data already synced into Postgres
(never Sleeper live) and requires no auth. It ships the structural reads whose
data exists today; the bracket-derived history (hall of fame, championships,
playoff head-to-head) is deferred to a later slice that follows the separate
Bracket track.

This is the second slice of a decomposed API layer:
- **API-1** (done) — auth foundation (JWT login, role/league-grant deps, CLI).
- **API-2 (this)** — public read endpoints.
- **API-3** — admin actions (season/league CRUD, league entry → sync, "sync
  now", owner mapping, scoring-validation review, mismatch queue).
- **Bracket** — separate track (pure `bracket_engine` + endpoints).
- **History (later)** — hall of fame + bracket-derived owner history, after the
  Bracket track lands.

## Goals

- Serve read-only season, standings, league, team, and basic owner-profile data
  to the public SPA with no authentication.
- Keep routers thin; put owner-profile aggregation in a dedicated, independently
  testable `history` module that is the future home for hall-of-fame aggregation.
- Expose only public-safe fields; keep scoring internals and owner PII private.

## Non-Goals (later slices)

- Hall of fame / records leaderboards, championships, playoff head-to-head, and
  any bracket-derived owner history (deferred until after the Bracket track).
- Player-level rosters / weekly lineups — no team↔player table exists in the
  data model, so "rosters" here means teams with owner-of-record, not player
  lists.
- Admin action endpoints (API-3) and the bracket endpoints.
- Pagination, filtering, search, caching layers, ETags (datasets are tiny; add
  only if proven slow).
- Any write path.

## Decisions

- **No auth.** Every API-2 endpoint is public. No dependency on API-1's
  `get_current_account`/role deps.
- **Read-only.** Endpoints use the existing `app.db.get_db` request-scoped
  session for `SELECT` only; no commits.
- **Scoring internals stay private.** Public responses show canonical points
  only — `team.points_for`/`team.points_against` for aggregates and
  `weekly_score.sleeper_points` per week (the number that determines in-league
  results). The recompute value (`recomputed_points`), `bench_points`, and
  `mismatch_flag` are the admin fairness-check internals and are never exposed.
- **Owner PII.** Public owner data exposes `first_name`, `last_name`,
  `display_name`, `avatar_url`. `email` and `notes` are never exposed.
- **Standings order.** Teams are ordered by win percentage
  `(wins + 0.5·ties) / games` descending, then `points_for` descending (matches
  the platform seeding tiebreak). A team with zero games sorts last. Computed in
  Python (a handful of teams per league).
- **No pagination.** Flat lists; datasets are small (a few leagues, ~10–12 teams
  each, dozens of owners).
- **Errors.** Unknown path id → `404`. Empty collections → `200` with `[]`.
  Malformed path params → FastAPI default `422`. Mirrors API-1 conventions.

## Architecture & Module Structure

Extends the existing `app/api/` package plus a new top-level `app/history/`:

- `app/api/seasons.py` — `APIRouter` for `/seasons`.
- `app/api/leagues.py` — `APIRouter` for `/leagues` and `/teams` (same resource
  family; split `/teams` into its own module only if the file grows unwieldy).
- `app/api/owners.py` — `APIRouter` for `/owners`.
- `app/api/public_schemas.py` — Pydantic response models for the read layer
  (`model_config = ConfigDict(from_attributes=True)` where reading from ORM
  objects). Kept separate from the auth `app/api/schemas.py`.
- `app/history/__init__.py`, `app/history/service.py` — owner-profile
  aggregation query functions taking a `Session`, returning plain
  dataclasses/dicts (not ORM rows). Independently unit-testable; future home for
  hall-of-fame/bracket aggregation.
- `app/main.py` — `create_app()` includes the three new routers.

Dependency direction: routers depend on `public_schemas`, `app.db`,
`app.models`, and (for owners) `app.history.service`. `history.service` depends
only on `app.models` and SQLAlchemy. Nothing in API-2 depends on API-1's auth
modules.

## Endpoints

All public, no auth, JSON responses.

### Seasons

- `GET /seasons` — list all seasons, ordered by `year` descending. Each:
  `SeasonSummary {id, year, status}`.
- `GET /seasons/{season_id}` — `SeasonDetail {id, year, status,
  playoff_field_per_league, nfl_playoff_weeks, leagues: [LeagueSummary]}` where
  `LeagueSummary {id, name, scoring_validated}`. `404` if no such season.

### Leagues & teams

- `GET /leagues/{league_id}` — `LeagueDetail {id, name, season_id, season_year,
  scoring_validated, standings: [TeamStanding]}`. `TeamStanding {team_id, owner:
  OwnerRef | None, wins, losses, ties, points_for, points_against,
  league_finish}`, ordered by the standings rule. `OwnerRef {id, first_name,
  last_name, display_name, avatar_url}` (or `null` when the team has no mapped
  owner). `404` if no such league.
- `GET /teams/{team_id}` — `TeamDetail {id, league_id, league_name, season_year,
  owner: OwnerRef | None, wins, losses, ties, points_for, points_against,
  league_finish, weekly_scores: [WeeklyScoreEntry]}`. `WeeklyScoreEntry {week,
  points, is_final}` where `points = weekly_score.sleeper_points`, ordered by
  `week` ascending. `404` if no such team.

### Owners

- `GET /owners/{owner_id}` — `OwnerProfile {id, first_name, last_name,
  display_name, avatar_url, season_records: [OwnerSeasonRecord], best_weekly:
  [BestWeeklyEntry]}`. `404` if no such owner.
  - `OwnerSeasonRecord {season_year, league_id, league_name, wins, losses, ties,
    points_for, points_against, league_finish}` — one row per team the owner
    held, ordered by `season_year` descending then `league_name`. The per-season
    league inherently shows owner movement across years.
  - `BestWeeklyEntry {season_year, league_name, week, points}` — top N by
    `sleeper_points` across all the owner's teams (default N = 5), ordered by
    `points` descending.

`/health` and the API-1 `/auth/*` routes are unchanged.

## History Aggregation (`app/history/service.py`)

Pure query functions over a `Session`, no HTTP, no ORM rows in the return type:

- `owner_season_records(db: Session, owner_id: int) -> list[OwnerSeasonRecord]`
  — join `owner → team → league → season`; one entry per team-season with
  record, points, and `league_finish`.
- `owner_best_weekly(db: Session, owner_id: int, limit: int = 5) ->
  list[BestWeeklyEntry]` — join the owner's teams to `weekly_score`, order by
  `sleeper_points` desc, take `limit`, carrying season/league/week context.

The router assembles `OwnerProfile` from the owner row plus these two functions.
Return types are lightweight dataclasses (or `pydantic` models) that the
response schemas read via `from_attributes`.

## Error Semantics

- Unknown `season_id` / `league_id` / `team_id` / `owner_id` → `404` with a
  generic detail.
- Empty child collections (a season with no leagues, a league with no teams, an
  owner with no records) → `200` with an empty list, not `404`.
- Malformed path params (non-int) → FastAPI default `422`.

## Testing Strategy

FastAPI `TestClient` with `app.dependency_overrides[get_db]` pointed at the
rolled-back `db_session` fixture (Postgres via the existing test DB); reuse the
`app`/`client` fixtures from `tests/api/conftest.py`. Add read-layer seed helpers
(season → league → teams → owners → weekly scores). No live network.

- **Seasons:** `GET /seasons` ordering (newest year first) and empty case;
  `GET /seasons/{id}` embeds leagues; `404` on unknown id.
- **Leagues:** `GET /leagues/{id}` returns teams in standings order — seed teams
  deliberately out of order (mixed win%/points-for, a team with ties, a team
  with zero games) and assert the sorted result; owner-of-record present and a
  `null`-owner team handled; `404` on unknown id.
- **Teams:** `GET /teams/{id}` returns weekly scores ordered by week with
  `points == sleeper_points`; `404` on unknown id.
- **Owners:** `GET /owners/{id}` returns season-by-season records across two
  leagues/years (movement) and best-weekly top-N respecting the limit and
  ordering; empty-history owner returns empty lists; `404` on unknown id.
- **Privacy (explicit):** assert that no public response body contains
  `recomputed_points`, `bench_points`, `mismatch_flag`, owner `email`, or owner
  `notes`.
- **History service:** `owner_season_records` and `owner_best_weekly` called
  directly with a Session over a seeded multi-season owner, asserting the joins
  and ordering independently of HTTP.

## Open Items (later slices)

- Hall of fame / records and all bracket-derived owner history — after the
  Bracket track.
- Response caching / ETags — only if read latency proves to be a problem.
- A flat `GET /leagues` or `GET /owners` directory listing — add if the frontend
  needs it; season detail + team owner-of-record links cover navigation for now.
