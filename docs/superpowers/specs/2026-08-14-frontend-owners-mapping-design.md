# FE-3c: Owners & Mapping + Public Owner Profile — Design

Date: 2026-08-14
Track: Frontend admin area (FE-3), third slice. Follows FE-3a (shell/auth), FE-3b (seasons/leagues).
Branch: `plan/fe-3c-owners-mapping`

## Goal

Three "owners" surfaces:
1. **Admin owners** — list/search, create, view, edit (`/admin/owners`, `/admin/owners/:id`).
2. **Team → owner mapping worksheet** (`/admin/leagues/:id/mapping`) — the FE-3b deferral;
   assign an owner to each team in a league, with an inline-create shortcut.
3. **Public owner profile** (`/owners/:id`) — resolves the owner links that currently 404
   on the public standings + team pages.

Together this makes owner identity fully manageable through the UI and closes the
public owner-link gap. See [[fe-3-admin-track]], [[admin-capabilities-need-ui]].

## Roles (backend-enforced; UI mirrors)

- **Create / list / view owners** — any admin (`get_current_account`).
- **Edit owner** (`PATCH /admin/owners/{id}`) — **super-admin only** (`require_super_admin`).
- **Mapping** (`GET/PATCH /admin/leagues/{id}/teams`) — league-admin+ (`require_league_admin`).
- Public owner profile — unauthenticated read.

## Backend contract (already shipped — no backend changes)

Admin owners (`app/api/admin/owners.py`):
- `POST /admin/owners` — `OwnerCreate { first_name, last_name, email?, display_name?, avatar_url?, notes? }` → `OwnerAdminResponse`; **409** on duplicate email.
- `GET /admin/owners?q=&limit=` → `OwnerAdminResponse[]` (search over first/last/display/email; `limit` 1–200, default 50; ordered newest first).
- `GET /admin/owners/{id}` → `OwnerAdminDetail` = `OwnerAdminResponse` + `sleeper_links: { sleeper_user_id, season, sleeper_display_name }[]`; 404.
- `PATCH /admin/owners/{id}` — `OwnerUpdate` (all fields optional) → `OwnerAdminResponse`; 404; **409** on email clash. **super-admin only.**

`OwnerAdminResponse` = `{ id, first_name, last_name, email: string|null, display_name: string|null, avatar_url: string|null, notes: string|null }`.

Mapping (`app/api/admin/mapping.py`):
- `GET /admin/leagues/{id}/teams` → `TeamMappingRow[]` = `{ team_id, sleeper_roster_id, sleeper_user_id: string|null, sleeper_display_name: string|null, owner: OwnerRef|null }` (ordered by roster id). `OwnerRef` = `{ id, first_name, last_name, display_name: string|null }`. 404 league.
- `PATCH /admin/leagues/{id}/teams/{team_id}` — `{ owner_id }` → `TeamMappingRow`; 404 league/team; **422** if owner doesn't exist.

Public (`app/api/owners.py`):
- `GET /owners/{id}` → `OwnerProfile { id, first_name, last_name, display_name, avatar_url, season_records: OwnerSeasonRecord[], best_weekly: BestWeeklyEntry[] }`. 404.
  - `OwnerSeasonRecord` = `{ season_year, league_id, league_name, wins, losses, ties, points_for, points_against, league_finish: number|null }`.
  - `BestWeeklyEntry` = `{ season_year, league_name, week, points }`.

## Architecture

### Routing

- `/admin/owners` → `OwnersListPage` (replaces the FE-3a Owners stub).
- `/admin/owners/:id` → `OwnerDetailPage`.
- `/admin/leagues/:id/mapping` → `MappingPage` (under `AdminLayout`).
- `/owners/:id` → `OwnerProfilePage` (under the public `PublicLayout`, before the `*` catch-all).

### Data / hooks

- Admin (`features/adminOwners.ts`):
  - `useOwners(q: string)` → `["owners", q]`, `GET /admin/owners?q=` (debounce `q` in the page, ~250ms).
  - `useOwner(id)` → `["owner", id]`, `GET /admin/owners/{id}` (`OwnerAdminDetail`).
  - `useCreateOwner()` → `POST`; invalidate `["owners"]` (all q-variants: `queryKey: ["owners"]` prefix). Returns the created owner (used by inline-create to immediately assign).
  - `useUpdateOwner(id)` → `PATCH`; invalidate `["owner", id]` + `["owners"]`.
  - `useTeamMappings(leagueId)` → `["mappings", leagueId]`, `GET /admin/leagues/{id}/teams`.
  - `useAssignTeamOwner(leagueId)` → `PATCH …/teams/{teamId}` with `{ teamId, ownerId }`; invalidate `["mappings", leagueId]`.
- Public (`features/useOwnerProfile.ts`):
  - `useOwnerProfile(id)` → `["ownerProfile", id]`, `GET /owners/{id}`.
- Types added to `types/api.ts`: `OwnerAdminResponse`, `OwnerAdminDetail`, `OwnerSleeperLinkRef`, `OwnerCreateBody`, `OwnerUpdateBody`, `TeamMappingRow`, `OwnerProfile`, `OwnerSeasonRecord`, `BestWeeklyEntry`. (`OwnerRef` already exists.)

### Components

- `OwnersListPage` — search input (debounced) + "New owner" (create modal, any admin) + result rows linking to detail.
- `OwnerFormDialog` — create + edit modes (radix `Dialog`, reused from FE-3b), fields first/last/email/display/avatar/notes; 409 inline; edit gated super-admin.
- `OwnerDetailPage` — header (avatar/name/display/email), notes, `sleeper_links` list, Edit (super-admin). Layered 404/loading/error.
- `MappingPage` — teams table; per-row `OwnerPicker`; unassigned/assigned states; back link to the season.
- `OwnerPicker` — **custom lightweight combobox**: a text input that debounce-searches `useOwners(q)`, a results dropdown, and an "＋ Create '{sleeperName}' as new owner" row. Selecting an existing result → `useAssignTeamOwner`. The create row opens `OwnerFormDialog` (create mode) **prefilled with `first_name` = the Sleeper name** (the backend requires both `first_name` and `last_name`, so a silent one-field create would make a blank-last-name owner — the form lets the admin complete it); on successful create the picker **auto-assigns** the new owner to that team. Keyboard + click select. Shows the current owner as the resting state. (No new dependency — built from an `<input>` + a positioned list; radix `Popover` optional but not required.)
- `OwnerProfilePage` (public) — header + season-records table + best-weekly list; reuses `ownerName`/`teamRecord`/`ordinal` (`features/standings.ts`).
- Season-detail integration: add a **"Map owners"** action to each league row (`LeagueRowActions`) linking to `/admin/leagues/:id/mapping` (visible to any admin, since mapping is league-admin+).

### Cache coherence

Assigning an owner changes public standings/team/owner data, but per FE-3b's established pattern we only invalidate the admin caches touched (`["mappings", leagueId]`); the public site refreshes on its own `staleTime`. (Consistent with the FE-3b sync decision — not auto-invalidating public queries from admin writes.)

## States & errors

- Lists/detail/profile: layered `isPending`/`isError`/empty; invalid NaN id → not-found; 404 → friendly not-found (reuse `NotFound` with title/message).
- Create/edit owner 409 → inline "An owner with that email already exists."
- Assign 422 (owner vanished) → inline row error; refetch mappings.
- Empty search → show all (backend returns newest 50); no-results → "No owners match."
- Role: New owner shown to any admin; **Edit** only super-admin; Map-owners link for any admin.

## Testing (Vitest + RTL + MSW)

Add MSW handlers for the owners + mapping + public-owner endpoints (success + 409/422/404). Honor the baked-in gotchas.

- **OwnersListPage:** lists owners; search filters (handler honors `q`); New owner create happy + 409 inline.
- **OwnerDetailPage:** renders header + sleeper_links; Edit shown super-admin, hidden league-admin; edit happy + 409; 404 not-found.
- **OwnerPicker:** typing searches; selecting a result assigns (PATCH); "Create new owner" creates then assigns; shows current owner.
- **MappingPage:** renders team rows with assigned/unassigned; assign updates the row; 404 league.
- **OwnerProfilePage:** renders season records + best-weekly; 404; owner links from FE-1b now resolve (spot-check a link target).
- **Role-awareness** across the admin surfaces.
- Behavior assertions (rendered rows, search results, role-gated buttons, error text), not mocks.

## Non-goals (deferred)

- Accounts & grants (FE-3d); bracket admin (FE-3e).
- A "teams owned by this owner" section on the owner detail page.
- Grant-based league filtering for league-admins.
- Auto-invalidating public queries from admin owner/mapping writes (matches FE-3b).
- Bulk mapping / CSV import.

## Definition of done

- `frontend/`: `npm run build`, `npm test`, `npm run lint` all green.
- An admin can create/search/view/edit owners and map every team in a league to an owner
  (including creating an owner inline), entirely through the UI.
- The public owner links on the standings + team pages resolve to a real profile.
- Role-aware: edit is super-admin only; everything else per the role table.
- Human eyeball of the admin owner pages, the mapping worksheet, and the public profile in
  light + dark (needs the backend running + a synced league with teams).
