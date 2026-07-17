# Admin: Season & League Setup (API-3a) — Design

## Summary

API-3a is the first slice of the admin action layer: Super-Admin endpoints to
create and edit seasons, enter a Sleeper league (which runs `sync_league_setup`
to validate scoring and create teams), re-run that setup sync as a
scoring-validation review, and remove a mis-entered league. It builds on API-1
(auth) and API-2 (public reads), and reuses the existing `SyncService`
synchronously from the request.

This is the first of three admin sub-slices decomposed from the original API-3:
- **API-3a (this)** — season & league setup, league entry, scoring-validation review.
- **API-3b** — owner identity & mapping (season-aware Sleeper-user → owner);
  first League-Admin-scoped surface, where the `require_league_admin` reshape
  (deferred from API-1) comes due.
- **API-3c** — in-season ops: on-demand "sync now" + the scoring-mismatch queue.

## Goals

- Let a Super Admin create/edit seasons and enter Sleeper leagues through the API.
- On league entry, synchronously run `sync_league_setup` and return the scoring
  validation result (validated flag + diffs) and the created teams.
- Provide a re-validation path (re-run setup sync) as the review loop.
- Enforce Super-Admin-only access server-side on every endpoint.

## Non-Goals (later slices / deferred)

- Owner identity & mapping (API-3b); on-demand week sync and the mismatch queue
  (API-3c).
- Scoring-ruleset CRUD. `season.scoring_ruleset_id` stays optional; when null,
  validation/scoring fall back to `DEFAULT_PPR` (what the worker already does).
- Season deletion (rare and destructive; status management covers the need).
- Persisting validation diffs (review re-runs the sync for always-fresh diffs).
- Season status state-machine enforcement (transitions are unrestricted for now).
- League-Admin-scoped access (no `require_league_admin` use here).

## Decisions

- **Sync trigger:** league entry runs `sync_league_setup` **synchronously** in
  the request via a request-scoped `SleeperClient`. The worker is idle during
  `SETUP`-status seasons, so there is no worker/API contention on those rows.
  This deviates from the platform "API never calls Sleeper" principle for this
  one bounded, interactive setup path, reusing the client's built-in backoff.
- **Auth:** every endpoint depends on API-1's `require_super_admin` (401 no
  token, 403 non-super-admin).
- **Ruleset resolution:** a shared `resolve_ruleset(session, season)` helper
  returns the season's ruleset rows or `DEFAULT_PPR` when unset. The worker's
  `cycle.py` currently inlines this; it is extracted and `cycle.py` updated to
  use it (targeted DRY cleanup).
- **Validation review = re-sync.** Diffs are not persisted; `resync-setup`
  re-fetches from Sleeper and returns current diffs.

## Architecture & Module Structure

New `app/api/admin/` subpackage plus small shared helpers:

- `app/api/admin/__init__.py`
- `app/api/admin/schemas.py` — admin request/response Pydantic models.
- `app/api/admin/seasons.py` — season CRUD router (`APIRouter(prefix="/admin",
  tags=["admin"], dependencies=[Depends(require_super_admin)])`).
- `app/api/admin/leagues.py` — league entry / resync / delete router (same
  prefix, tags, and Super-Admin dependency).
- `app/api/deps.py` (extend) — add `get_sleeper_client` async dependency:
  `client = SleeperClient(); try: yield client; finally: await client.aclose()`.
- `app/sync/ruleset.py` — `resolve_ruleset(session: Session, season: Season) ->
  Mapping[str, float]`.
- `app/worker/cycle.py` (modify) — replace the inline ruleset resolution with
  `resolve_ruleset`.
- `app/main.py` — include the two admin routers.

Dependency direction: admin routers depend on `require_super_admin`,
`get_db`, `get_sleeper_client`, `app.sync.service.SyncService`,
`app.sync.ruleset.resolve_ruleset`, `app.models`, and the admin schemas.

## Endpoints

All under `/admin`, all Super-Admin-only. JSON in/out.

### Seasons

- `POST /admin/seasons` — body `SeasonCreate {year: int, scoring_ruleset_id: int
  | None = None, playoff_field_per_league: int = 2, nfl_playoff_weeks: list[int]
  = [], status: SeasonStatus = SeasonStatus.SETUP}`. Creates a season. **201**
  with `SeasonAdminResponse`. **409** if `year` already exists.
- `PATCH /admin/seasons/{season_id}` — body `SeasonUpdate` (all fields optional:
  `scoring_ruleset_id`, `playoff_field_per_league`, `nfl_playoff_weeks`,
  `status`). Applies provided fields only. **200** with `SeasonAdminResponse`.
  **404** if unknown. `year` is immutable (not in `SeasonUpdate`).

### League entry & review

- `POST /admin/seasons/{season_id}/leagues` — body `LeagueEntryRequest
  {sleeper_league_id: str}`. Loads the season (**404** if unknown), resolves the
  ruleset, builds a `SyncService`, and `await`s `sync_league_setup`. **201**
  with `LeagueSetupResponse`. Idempotent: re-entering an existing
  `(season, sleeper_league_id)` refreshes it rather than duplicating.
- `POST /admin/leagues/{league_id}/resync-setup` — re-runs `sync_league_setup`
  for an existing league (looked up to recover its season + sleeper id).
  **200** with `LeagueSetupResponse`. **404** if unknown league.
- `DELETE /admin/leagues/{league_id}` — deletes the league (its teams cascade
  via FK). **204**. **404** if unknown league.

### Schemas (`admin/schemas.py`)

- `SeasonCreate`, `SeasonUpdate` — as above.
- `SeasonAdminResponse {id, year, status: SeasonStatus, scoring_ruleset_id: int |
  None, playoff_field_per_league: int, nfl_playoff_weeks: list[int]}`
  (`from_attributes=True`).
- `LeagueEntryRequest {sleeper_league_id: str}`.
- `ScoringDiff {category: str, league_value: float, platform_value: float}` —
  built from `LeagueSyncResult.diffs` (`list[tuple[str, float, float]]`).
- `TeamRef {team_id: int, sleeper_roster_id: int, sleeper_user_id: str | None}`.
- `LeagueSetupResponse {league_id: int, name: str, scoring_validated: bool,
  diffs: list[ScoringDiff], teams: list[TeamRef]}`.

The `diffs` field is admin-only and never appears on the public API-2 surface.

## Data Flow

League entry / resync:

1. Resolve the season (from path for entry; via `league.season_id` for resync).
2. `ruleset = resolve_ruleset(session, season)`.
3. `service = SyncService(client, session, season, ruleset)` with the
   request-scoped `SleeperClient`.
4. `result = await service.sync_league_setup(sleeper_league_id)`.
5. Query the league's teams; build `LeagueSetupResponse` (map diffs → `ScoringDiff`,
   teams → `TeamRef`).
6. The request-scoped session commits on success (admin writes are transactional;
   `SyncService` flushes, the endpoint commits).

Because `sync_league_setup` mixes an async Sleeper client with the sync
`Session`, the endpoints are `async def` and `await` the service — the same
pattern the worker uses.

## Error Semantics

- Unknown `season_id` / `league_id` → **404**.
- Duplicate season `year` on create → **409** (pre-check by year, or catch the
  unique-violation and translate).
- `SleeperNotFound` (the `sleeper_league_id` doesn't exist upstream) → **422**.
- `SleeperUnavailable` or any other `SleeperError` / `SyncError` (upstream fetch
  failed after retries) → **502**.
- Missing token → **401**; authenticated non-super-admin → **403**.
- Malformed body → FastAPI default **422**.

## Testing Strategy

FastAPI `TestClient` with `get_db` overridden to the rolled-back `db_session`
fixture, and `get_sleeper_client` overridden with a `MockTransport`-routed
`SleeperClient` (the existing `route_client` pattern from `tests/sync/conftest.py`)
serving the recorded `league.json` / `users.json` / `rosters.json` fixtures — no
live network. Super-Admin auth via API-1's `make_account` + a bearer token.

- **Auth:** a representative admin endpoint returns **401** without a token,
  **403** for a `LEAGUE_ADMIN`, and succeeds for a `SUPER_ADMIN`.
- **Season create:** **201** + persisted row with the given fields; a second
  create with the same `year` → **409**.
- **Season patch:** updates only the provided fields (e.g. `status`,
  `playoff_field_per_league`); **404** on unknown id.
- **League entry:** with a routed mock client, asserts the league and its teams
  are created and the response carries `scoring_validated` + `diffs`. Two ruleset
  cases: a ruleset matching the fixture's `scoring_settings` →
  `scoring_validated=True` and empty `diffs`; a mismatching ruleset → populated
  `diffs`. Re-entering the same `(season, sleeper_league_id)` does not create a
  second league row.
- **resync-setup:** an existing league re-syncs and returns fresh diffs; **404**
  on unknown league.
- **Delete:** the league is removed and its teams cascade; **204**; **404** on
  unknown league.
- **Upstream failure:** a mock client raising `SleeperUnavailable` → **502**;
  a mock client raising `SleeperNotFound` → **422**.
- **`resolve_ruleset` (unit):** a season with a persisted `ScoringRuleset` row
  returns that row's `rules`; a season with `scoring_ruleset_id=None` returns
  `DEFAULT_PPR`. The existing worker suite stays green after `cycle.py` adopts
  the helper.

## Open Items (later slices)

- Owner identity & mapping (API-3b); on-demand week sync + mismatch queue (API-3c).
- Scoring-ruleset CRUD — needed before seasons can use non-default rulesets
  through the API.
- Season status transition rules — add a state machine if invalid transitions
  become a problem.
