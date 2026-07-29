# Admin: Owner Identity & Mapping (API-3b) — Design

**Date:** 2026-07-29
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Super-Admin and League-Admin API endpoints to manage the platform's persistent
**Owner** entities and to map each synced Sleeper roster (`team`) to an Owner.
This completes annual season-setup Flow 1 step 4 ("map each Sleeper user to an
owner") and makes the already-shipped public **owner profiles** (API-2) actually
populate, since owner history is derived from `team.owner_id`.

This is the first of three follow-on admin units decomposed from a larger "all
of these" request:

- **API-3b (this spec)** — owner identity & mapping.
- **API-3c (later)** — manual per-league "sync now" trigger + League-Admin
  enablement (Sleeper-commish auto-grant, League-Admin account creation).
- **API-4 (later)** — the super-bracket track (`bracket_engine` + generation /
  approval / round finalization).

API-3b is the natural first piece: it continues the 3a admin-setup track and is
where the `require_league_admin` reshape (flagged as "comes due in API-3b")
lands.

## Goals

- CRUD-lite for platform **Owner** records: create, search/list (for reuse),
  view, edit. No delete (Owner is the persistent history spine; deletion is
  deferred behind future guards).
- A per-league **mapping worksheet** (read) and a per-team **assign** (write)
  that set `team.owner_id` and upsert the season-aware `owner_sleeper_link`.
- Enforce access: Owner create/search/view for any admin; Owner edit for
  Super-Admin only; league mapping for Super-Admin **or** the League-Admin
  granted that league.
- Reshape `require_league_admin` into the idiomatic FastAPI path-param form and
  cover it with an end-to-end `{league_id}`-in-path route test.
- Persist the Sleeper **display name** on `team` so the mapping worksheet is
  human-usable (an admin must see "John Smith", not an opaque `sleeper_user_id`).

## Non-Goals (YAGNI for 3b)

- Deleting Owners.
- Unassigning a team's owner (setting `owner_id` back to null). `owner_id` is
  required on the assign endpoint; re-assigning to a different owner is
  supported. Unassign is an easy later add.
- Bulk / whole-league batch mapping. Mapping is per-team.
- Inline Owner creation inside the assign call. Owners are a separate resource;
  create first, then assign.
- League-Admin account creation and Sleeper-commish auto-grant (that is API-3c).
  3b's League-Admin path is fully testable now via seeded `league_admin_grant`
  rows.

## Existing State (grounding)

- `Owner` (`app/models/identity.py`): `first_name, last_name, email (unique,
  nullable), display_name, avatar_url, notes` + `sleeper_links` relationship
  (cascade delete-orphan).
- `OwnerSleeperLink`: `owner_id, sleeper_user_id, sleeper_display_name, season`;
  unique on `(sleeper_user_id, season)`.
- `Team` (`app/models/competition.py`): `league_id, sleeper_roster_id,
  owner_id (nullable, SET NULL), sleeper_user_id (nullable)`, standings fields.
  **No display-name column yet.**
- Sync (`app/sync/service.py` `_upsert_teams`) sets `team.sleeper_user_id =
  roster.owner_id` and preserves `owner_id`, but **drops the Sleeper display
  name** — only the commissioner id is extracted from the `users` payload.
- `require_league_admin` (`app/api/deps.py`) is still the un-bindable factory
  `require_league_admin(league_id) -> dependency`; it has no route consumers yet
  (only direct-call tests).
- `SleeperUser.display_name: str | None` and `SleeperRoster.owner_id: str | None`
  both exist, so a `roster.owner_id → user.display_name` join is available during
  setup sync.

## Data Model Change

Add one nullable column to `team`:

- `Team.sleeper_display_name: Mapped[str | None] = mapped_column(String(100))`

Plus an Alembic migration adding the column (nullable, no backfill required;
resync-setup repopulates it).

## Sync Change

`SyncService._upsert_teams` gains an optional `users` argument:

```python
def _upsert_teams(
    self, league: League, rosters: list[SleeperRoster],
    users: list[SleeperUser] | None = None,
) -> list[Team]:
```

- When `users` is provided (league **setup / resync-setup** path), build
  `{user_id: display_name}` and set `team.sleeper_display_name` from
  `roster.owner_id`.
- When `users` is `None` (weekly sync path, which does not fetch users),
  **preserve** the existing `sleeper_display_name`.

`sync_league_setup` already fetches `users`; it passes them through. `sync_week`
keeps calling `_upsert_teams(league, rosters)` unchanged.

## API Surface

All routers live under the existing `/admin` prefix, `tags=["admin"]`, following
the 3a pattern. Write endpoints must `db.commit()` (`get_db` does not commit).

### Auth model

Every `Account` is an admin (roles are only `super_admin` / `league_admin`), so
"any admin" = a valid bearer token (`Depends(get_current_account)`; 401 when
absent). The Owner router therefore uses **per-route** dependencies rather than a
router-level guard.

### Owner resource — `app/api/admin/owners.py`

| Method & path | Auth | Success | Errors |
|---|---|---|---|
| `POST /admin/owners` | any admin | 201 | 409 duplicate email; 422 malformed |
| `GET /admin/owners?q=&limit=50` | any admin | 200 list | — |
| `GET /admin/owners/{owner_id}` | any admin | 200 (with links) | 404 |
| `PATCH /admin/owners/{owner_id}` | super-admin | 200 | 404; 409 email collision; 403 for league-admin |

- **Create** body: `first_name, last_name, email?, display_name?, avatar_url?,
  notes?`. `409` only when a non-null `email` already exists.
- **Search**: `q` is a case-insensitive substring match across `first_name`,
  `last_name`, `display_name`, and `email`; capped by `limit` (default 50). No
  `q` → most-recent owners up to `limit`. Purpose: find and reuse an existing
  Owner instead of duplicating.
- **Edit**: partial update (`exclude_unset`); Super-Admin only. `409` if the new
  email collides with another owner.

### League mapping — `app/api/admin/mapping.py`

Each route guarded by the reshaped `require_league_admin` (bare
`Depends(require_league_admin)`), which reads `{league_id}` from the path.

| Method & path | Success | Errors |
|---|---|---|
| `GET /admin/leagues/{league_id}/teams` | 200 list of mapping rows | 404 unknown league (super-admin); 403 non-granted league-admin; 401 no token |
| `PATCH /admin/leagues/{league_id}/teams/{team_id}` | 200 updated row | 404 unknown league or team-not-in-league; 422 unknown `owner_id`; 403 / 401 as above |

- **Worksheet row**: `{team_id, sleeper_roster_id, sleeper_user_id,
  sleeper_display_name, owner: {id, first_name, last_name, display_name} | null}`.
- **Assign** body: `{owner_id}` (required). Validates the team belongs to
  `{league_id}` (else 404) and the owner exists (else 422). Then:
  - Sets `team.owner_id = owner_id`.
  - If `team.sleeper_user_id` is not null: upsert `OwnerSleeperLink` keyed by
    `(sleeper_user_id, season=league.season.year)` — set `owner_id` and
    `sleeper_display_name = team.sleeper_display_name`. Re-assigning to a
    different owner updates this same link row via the unique key.
  - If `team.sleeper_user_id` is null (unowned Sleeper roster): set
    `team.owner_id` only; skip the link (it cannot be keyed).
  - `db.commit()`, return the refreshed worksheet row.

## `require_league_admin` reshape

`app/api/deps.py`, from factory to path-param dependency:

```python
from fastapi import Path

def require_league_admin(
    league_id: int = Path(...),
    account: Account = Depends(get_current_account),
    db: Session = Depends(get_db),
) -> Account:
    if account.role is AccountRole.SUPER_ADMIN:
        return account
    grant = db.execute(
        select(LeagueAdminGrant).where(
            LeagueAdminGrant.account_id == account.id,
            LeagueAdminGrant.league_id == league_id,
        )
    ).scalar_one_or_none()
    if grant is None:
        raise _forbidden()
    return account
```

Consumed as bare `Depends(require_league_admin)`. Auth is checked before route
existence, so a non-super, non-granted caller gets `403` even for a league that
does not exist (existence is not leaked); a Super-Admin passes the dependency and
the handler then returns `404` for an unknown league.

The API-1 tests that call the old factory directly are updated to the new form,
and a new end-to-end test exercises a real `{league_id}` route through the
`TestClient` — the coverage the old direct-call tests could not provide.

## Error Mapping (consistent with 3a)

- `401` — no / invalid token.
- `403` — wrong role (league-admin hitting Owner edit) or league-admin without a
  grant for `{league_id}`.
- `404` — unknown league or team in the path; team not in the named league.
- `422` — assign body references a non-existent `owner_id`; malformed body.
- `409` — duplicate Owner email.

## Schemas

Added to `app/api/admin/schemas.py`:

- `OwnerCreate {first_name, last_name, email: str | None = None,
  display_name: str | None = None, avatar_url: str | None = None,
  notes: str | None = None}`
- `OwnerUpdate` — all fields optional (partial edit).
- `OwnerSleeperLinkRef {sleeper_user_id, season, sleeper_display_name}`
  (`from_attributes=True`).
- `OwnerAdminResponse {id, first_name, last_name, email, display_name,
  avatar_url, notes}` (`from_attributes=True`) — used by list.
- `OwnerAdminDetail(OwnerAdminResponse) { sleeper_links: list[OwnerSleeperLinkRef] }`
  — used by get-one.
- `OwnerRef {id, first_name, last_name, display_name}` — embedded in a worksheet
  row.
- `TeamOwnerAssign {owner_id: int}`.
- `TeamMappingRow {team_id, sleeper_roster_id, sleeper_user_id,
  sleeper_display_name, owner: OwnerRef | None}`.

## Testing Strategy

Test-driven, Postgres-backed (matching the 3a suite). New modules
`tests/api/admin/test_owners.py`, `tests/api/admin/test_mapping.py`; reuse
`super_admin` / `admin_headers` fixtures.

- **Owners**: create success + `409` duplicate email; search filters by `q`;
  get-one returns links + `404`; edit updates fields, `404`, `409` email
  collision, and `403` when a league-admin attempts edit; `401` without a token.
- **Mapping**: worksheet lists rows with display names, owner refs, and `null`
  for unmapped teams; assign sets `owner_id` and upserts the link; re-assign to a
  different owner updates the same link; `422` for unknown `owner_id`; `404` for
  a team not in the named league; a null-`sleeper_user_id` team assigns
  `owner_id` without a link.
- **Auth / reshape**: a league-admin **with** a grant maps their own league
  (200) but gets `403` on another league; no-token `401`; the end-to-end
  `{league_id}` route test; updated API-1 direct-call tests.
- **Sync**: `_upsert_teams` sets `sleeper_display_name` from `users` on setup and
  preserves it when `users` is omitted (weekly sync).
- Full suite green; only the known baseline warnings (PyJWT
  `InsecureKeyLengthWarning`, `StarletteDeprecationWarning`).

## Files

- **Create**: `app/api/admin/owners.py`, `app/api/admin/mapping.py`,
  `tests/api/admin/test_owners.py`, `tests/api/admin/test_mapping.py`, one
  Alembic migration.
- **Modify**: `app/api/admin/schemas.py` (new schemas), `app/api/deps.py`
  (reshape + `Path` import), `app/models/competition.py`
  (`Team.sleeper_display_name`), `app/sync/service.py` (`_upsert_teams` users
  join), `app/main.py` (mount both routers), and the API-1 auth tests that call
  the old `require_league_admin` factory.

## Constraints

- All commands from `backend/`. Tests: `uv run pytest ...`. Postgres required
  (test DB `insight2redraft_test`).
- No new dependencies. No pagination. `diffs` and other admin-only detail never
  leak into public (API-2) responses.
- Every write path must `db.commit()`.
