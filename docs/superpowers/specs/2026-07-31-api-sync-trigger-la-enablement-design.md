# Admin: Manual Sync Trigger + League-Admin Enablement (API-3c) — Design

**Date:** 2026-07-31
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Two related admin capabilities that make **League Admins real and useful**:

1. A **manual "sync now"** endpoint — a super-admin (any league) or a scoped
   league-admin (their league) can force a league's current-week sync on demand,
   outside the worker's cadence, and get the result immediately.
2. **Super-admin-managed League-Admin enablement** — endpoints to create
   League-Admin accounts, reset their passwords, remove them, and grant/revoke a
   league to an account. Until now the only account path was the
   `create-superadmin` CLI, so no League-Admin could exist at all.

This is the second of three follow-on admin cycles decomposed from a larger
request:

- **API-3b (merged, PR #10)** — owner identity & mapping.
- **API-3c (this spec)** — manual sync trigger + League-Admin enablement.
- **API-4 (later)** — the super-bracket track.

**Sleeper-commish auto-grant is explicitly deferred** (see Non-Goals).

## Goals

- `POST /admin/leagues/{league_id}/sync` — synchronous current-week sync for an
  active-season league, scoped by `require_league_admin`.
- Super-admin CRUD-lite for League-Admin **accounts**: create, list (with
  grants), reset password, delete.
- Super-admin **grant** management: grant / revoke a league to an account,
  account-nested.
- Enforce the existing role model end-to-end; the granted League-Admin can then
  actually sync (and, from 3b, map owners for) their own league.

## Non-Goals (YAGNI for 3c)

- **Sleeper-commish auto-grant.** Auto-linking `league.commish_sleeper_id` →
  owner (via 3b's `OwnerSleeperLink`) → account → grant has real bootstrapping
  edge cases (needs a pre-existing, owner-mapped account). Deferred; grants are
  managed explicitly by a super-admin in 3c.
- **Super-admin promotion via API.** `POST /admin/accounts` creates only
  `league_admin` accounts; super-admins still come from the `create-superadmin`
  CLI. SA-to-SA grant/revoke is a later concern.
- **Email-invite / self-service / magic-link flows.** A super-admin sets the
  initial password directly (matches the spec's "email+password to start").
- **Signaling the worker or background jobs for sync-now.** Sync-now runs
  synchronously in the request (decision below).
- **Arbitrary past-week / past-season manual sync.** Sync-now targets the
  current active season's current week only.
- Editing an account's email or role after creation.

## Key Decision: sync-now runs synchronously in the API

The worker owns Sleeper I/O on a cadence (~3 min in game windows, ~30 min
in-season, ~6 h idle), with no queue between API and worker. A "sync now" button
is an interactive action wanting an immediate result. Rather than signal the
worker (no immediate result; latency up to the cadence) or use a background task
(no result to show), sync-now **calls `SyncService.sync_week` synchronously in
the request** via the request-scoped `get_sleeper_client` — the same
admin-path-calls-Sleeper exception already established and accepted in API-3a
(league entry) and API-3b. It reuses the tight-timeout admin client
(`timeout=10.0, max_retries=1`) that bounds the connection-holding window.

## Existing State (grounding)

- `SyncService(client, session, season, ruleset)`; `sync_week(league_id, week)
  -> WeekSyncResult(scored_team_ids: list[int], skipped_roster_ids: list[int])`;
  methods flush but never commit — the caller owns the transaction.
- `resolve_ruleset(session, season)` resolves the season's ruleset or
  `DEFAULT_PPR` (shared by worker + admin).
- `get_sleeper_client()` (API-3b, `app/api/deps.py`) — async-generator dependency
  yielding a tight-timeout `SleeperClient`, closed in `finally`.
- `require_league_admin` (reshaped in 3b) — path-param dependency:
  `require_league_admin(league_id: int = Path(...), account, db) -> Account`;
  super-admin bypasses, else must hold a `LeagueAdminGrant` for `league_id`.
- `require_super_admin` — router-level gate used by the seasons/leagues admin
  routers.
- `client.get_nfl_state() -> NflState(season: str, week: int, ...)`; the worker
  derives `year = int(nfl_state.season)`, `week = nfl_state.week`.
- `SeasonStatus` = `SETUP | REGULAR | PLAYOFFS | COMPLETE`; worker treats
  `SETUP`/`COMPLETE` as idle.
- `Account(email unique, password_hash, role: AccountRole, owner_id: int | None
  FK owner ON DELETE SET NULL)`. `AccountRole` = `SUPER_ADMIN | LEAGUE_ADMIN`.
- `LeagueAdminGrant(account_id FK account ON DELETE CASCADE, league_id FK league
  ON DELETE CASCADE)`, unique `(account_id, league_id)`.
- `hash_password` / `verify_password` / `create_access_token` in
  `app/api/security.py`. Account creation today: only `app/cli.py`
  `create_superadmin`.
- Sleeper errors: `SleeperNotFound` (subclass of `SleeperError`),
  `SleeperError`; `SyncError` from the sync layer.

## API Surface

All routers under the existing `/admin` prefix, `tags=["admin"]`. Write paths
must `db.commit()` (`get_db` does not commit).

### Sync-now — `app/api/admin/sync.py` (per-route `require_league_admin`)

`POST /admin/leagues/{league_id}/sync`

1. `db.get(League, league_id)` → `404` if unknown. Load `league.season`.
2. Guard `season.status in {REGULAR, PLAYOFFS}` → else `409`
   (SETUP → "use resync-setup"; COMPLETE → "season complete").
3. `nfl_state = await client.get_nfl_state()`. Guard
   `league.season.year == int(nfl_state.season)` → else `409`
   ("manual sync only supports the current active season").
4. `ruleset = resolve_ruleset(db, season)`;
   `result = await SyncService(client, db, season, ruleset).sync_week(league_id, nfl_state.week)`.
   Map `SleeperNotFound` → `422`, other `SleeperError`/`SyncError` → `502`.
5. `db.commit()`. Count that week's mismatches:
   `WeeklyScore` join `Team` where `Team.league_id == league_id`,
   `week == nfl_state.week`, `mismatch_flag is True`.
6. Return `SyncNowResponse {league_id, week, teams_synced, rosters_skipped,
   mismatches}` where `teams_synced = len(result.scored_team_ids)`,
   `rosters_skipped = len(result.skipped_roster_ids)`.

### Accounts — `app/api/admin/accounts.py` (router-level `require_super_admin`)

| Method & path | Success | Errors |
|---|---|---|
| `POST /admin/accounts` | 201 | 409 dup email; 422 unknown `owner_id`; 422 malformed |
| `GET /admin/accounts` | 200 list (with grants) | — |
| `PATCH /admin/accounts/{account_id}` | 200 | 404 |
| `DELETE /admin/accounts/{account_id}` | 204 | 404; 409 last super-admin |

- **Create** body `AccountCreate {email, password, owner_id: int | None = None}`;
  role forced to `LEAGUE_ADMIN`; `password_hash = hash_password(password)`.
  `409` on duplicate email (pre-check **plus** `IntegrityError`→409, mirroring
  owners). If `owner_id` is provided, it must exist → else `422`. Response never
  includes `password_hash`.
- **List** returns every admin account with `role` and its `grants`
  (super-admins → empty list = global).
- **Reset password** body `AccountPasswordReset {password}`; sets
  `password_hash`; `404` unknown. (Email/role are not editable here.)
- **Delete** removes the account; its `LeagueAdminGrant` rows cascade
  (`ondelete=CASCADE`). `404` unknown. **`409` if the target is the only
  remaining `SUPER_ADMIN`** (lockout guard).

### Grants — same `accounts.py` router, account-nested

| Method & path | Success | Errors |
|---|---|---|
| `POST /admin/accounts/{account_id}/grants` | 201 | 404 unknown account/league; 409 duplicate; 422 account not a league_admin |
| `DELETE /admin/accounts/{account_id}/grants/{league_id}` | 204 | 404 no such grant |

- **Grant** body `GrantCreate {league_id}`. Validate account exists (`404`),
  league exists (`404`), account.role is `LEAGUE_ADMIN` (`422` — grants are
  meaningless on a globally-scoped super-admin), not already granted (`409`,
  unique constraint + IntegrityError). Returns
  `LeagueGrantRef {league_id, league_name}` (or the account with grants).
- **Revoke** deletes the `(account_id, league_id)` grant; `404` if absent.

## Schemas (added to `app/api/admin/schemas.py`)

- `SyncNowResponse {league_id: int, week: int, teams_synced: int,
  rosters_skipped: int, mismatches: int}`
- `AccountCreate {email: str, password: str, owner_id: int | None = None}`
- `AccountPasswordReset {password: str}`
- `GrantCreate {league_id: int}`
- `LeagueGrantRef {league_id: int, league_name: str}` (`from_attributes` where
  convenient)
- `AccountAdminResponse {id: int, email: str, role: AccountRole,
  owner_id: int | None, grants: list[LeagueGrantRef]}`

Enum `role` serializes to its `.value` (`"league_admin"` / `"super_admin"`),
consistent with the season-status responses.

## Error Mapping (consistent with 3a/3b)

- `401` no/invalid token · `403` wrong role, or league not granted.
- Sync-now: `404` unknown league; `409` season not `REGULAR`/`PLAYOFFS` or not the
  current NFL season; `422` `SleeperNotFound`; `502` other `SleeperError`/`SyncError`.
- Accounts: `409` dup email or last-super-admin delete; `404` unknown account;
  `422` unknown `owner_id`.
- Grants: `404` unknown account/league or absent grant; `409` duplicate grant;
  `422` account not a league_admin.

## Testing Strategy

Test-driven, Postgres-backed. New modules `tests/api/admin/test_sync.py`,
`tests/api/admin/test_accounts.py`; reuse `client`, `admin_headers`,
`super_admin`, `make_account`, `seed`, `db_session`, and `tests/sync/conftest`
`route_client` / `load_fixture` for the Sleeper mocks.

- **Sync-now**: with `route_client` routes for `nfl_state`, matchups, rosters,
  and weekly stats, a `REGULAR` current-season league returns the synced/skipped
  and `mismatches` counts; `404` unknown league; `409` for a `SETUP` season;
  `409` for a non-current season year; `502` on a failing Sleeper client; a
  league-admin **with** a grant syncs their own league (200) but gets `403` on
  another; `401` without a token. (Season year is set to match the mocked
  `nfl_state.season`.)
- **Accounts**: create a league-admin (+`409` dup email, +`422` unknown
  `owner_id`), response omits `password_hash`; list shows accounts with grants;
  reset password then `POST /auth/login` with the new password succeeds
  (end-to-end proof), +`404`; delete removes the account and cascades its grants,
  +`404`, +`409` when it's the last super-admin; a league-admin hitting any of
  these SA-only routes gets `403`; no token `401`.
- **Grants**: grant a league (+`404` unknown account/league, +`409` duplicate,
  +`422` when the account is a super-admin); revoke (+`404`); and an end-to-end
  check that after granting, that league-admin can `POST
  /admin/leagues/{id}/sync` for the granted league (200) but not another (403).
- Full suite green; only the known baseline warnings (PyJWT
  `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

## Files

- **Create**: `app/api/admin/sync.py`, `app/api/admin/accounts.py`,
  `tests/api/admin/test_sync.py`, `tests/api/admin/test_accounts.py`.
- **Modify**: `app/api/admin/schemas.py` (new schemas), `app/main.py` (mount both
  routers).

No model changes and no migration (all tables already exist).

## Constraints

- All commands from `backend/`. Tests: `uv run pytest ...`. Postgres required
  (test DB `insight2redraft_test`).
- No new dependencies. No pagination.
- Every write path must `db.commit()`.
- Admin-only detail never leaks into public (API-2) responses; account responses
  never include `password_hash`.
