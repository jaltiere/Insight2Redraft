# FE-3b: Seasons & Leagues Admin — Design

Date: 2026-08-12
Track: Frontend admin area (FE-3), second slice. Follows FE-3a (admin shell + auth).
Branch: `plan/fe-3b-seasons-leagues`

## Goal

Give admins a UI to manage the competition structure: **seasons** (list / create /
edit) and their **leagues** (add via Sleeper league ID with scoring-diff review,
resync-setup, sync-now, delete). This is the slice that lets a super-admin seed the
whole app through the UI and watch the public site populate.

Team owner-mapping is **out of scope** (deferred to FE-3c — it needs owners to
assign, and owner CRUD is FE-3c). See [[fe-3-admin-track]].

## Roles (enforced by the backend; the UI mirrors them)

- **Super-admin** — everything: create/edit season, add league, resync-setup,
  delete league, sync-now.
- **League-admin** — read the same views; the only write action is **Sync now**
  on a league (`require_league_admin`, scoped to granted leagues server-side).
  All super-admin-only buttons are **hidden** for league-admins.
- **No grant-based "only my leagues" filtering this slice** — the frontend has no
  grant data yet (grants surface in FE-3d). A league-admin's Sync on a
  non-granted league simply 403s and we show the error. Acceptable for now.

## Backend contract (already shipped — no backend changes)

Reads use the existing **public** endpoints (there is no admin GET for
seasons/leagues); writes use the admin endpoints.

Reads:
- `GET /seasons` → `SeasonSummary[]` (`id`, `year`, `status`).
- `GET /seasons/{id}` → `SeasonDetail` (`id`, `year`, `status`,
  `playoff_field_per_league`, `nfl_playoff_weeks`, `leagues: LeagueSummary[]`).
  `LeagueSummary` = `id`, `name`, `scoring_validated`.

Writes (admin):
- `POST /admin/seasons` **(super-admin)** — body `SeasonCreate` `{ year,
  scoring_ruleset_id?, playoff_field_per_league=2, nfl_playoff_weeks=[],
  status="setup" }` → `SeasonAdminResponse`; **409** if the year already exists.
- `PATCH /admin/seasons/{id}` **(super-admin)** — body `SeasonUpdate` (all
  optional: `scoring_ruleset_id`, `playoff_field_per_league`, `nfl_playoff_weeks`,
  `status`) → `SeasonAdminResponse`; 404 if not found.
- `POST /admin/seasons/{id}/leagues` **(super-admin, async)** — body
  `{ sleeper_league_id }` → `LeagueSetupResponse` `{ league_id, name,
  scoring_validated, diffs: {category, league_value, platform_value}[],
  teams: {team_id, sleeper_roster_id, sleeper_user_id}[] }`. **404** season,
  **422** "Sleeper league not found", **502** "Sleeper upstream error".
- `POST /admin/leagues/{id}/resync-setup` **(super-admin, async)** → same
  `LeagueSetupResponse`. 404 league/season, 422/502 as above.
- `POST /admin/leagues/{id}/sync` **(league-admin, async)** — no body → 
  `SyncNowResponse` `{ league_id, week, teams_synced, rosters_skipped,
  mismatches }`. **404** league; **409** if the season status is not
  regular/playoffs ("not syncable, use resync-setup during setup") or not the
  current NFL season; 422/502 upstream.
- `DELETE /admin/leagues/{id}` **(super-admin)** → 204; 404 if not found.

`SeasonStatus` = `setup | regular | playoffs | complete`.

## Architecture

### Routing (replaces the FE-3a Seasons stub)

- `/admin/seasons` → `SeasonsListPage` (super-admin sees "New season").
- `/admin/seasons/:id` → `SeasonDetailPage` (season header + Edit; Leagues table
  with inline actions + Add league).

Both live under the existing `AdminLayout` (authenticated). Season/league **writes**
are super-admin-only; the pages themselves are visible to any admin (reads are
public data). Guarding at the button level (not the route) keeps league-admins able
to view + sync.

### Reads / caches

- `useSeasons()` → `["seasons"]` (already exists as `useSeasons` for the public
  dashboard — reuse it).
- `useSeason(id)` → `["season", id]` (already exists — reuse).
- Mutations invalidate `["seasons"]` and/or `["season", id]` on success so the
  list + detail refresh (and the public site reflects new leagues).

### Mutations (React Query `useMutation`, no optimistic updates)

- `useCreateSeason` → `POST /admin/seasons`; on success invalidate `["seasons"]`.
- `useUpdateSeason(id)` → `PATCH`; invalidate `["season", id]` + `["seasons"]`.
- `useAddLeague(seasonId)` → `POST /admin/seasons/{id}/leagues`; invalidate
  `["season", seasonId]`.
- `useResyncLeague(id)` → `POST /admin/leagues/{id}/resync-setup`; invalidate the
  parent `["season", seasonId]`.
- `useSyncLeague(id)` → `POST /admin/leagues/{id}/sync`.
- `useDeleteLeague(id)` → `DELETE`; invalidate `["season", seasonId]`.

Errors surface via `isApiError(e)` → `e.detail`, shown inline in the relevant
modal/row.

### Components

- `src/pages/admin/SeasonsListPage.tsx` — list + "New season" button (super-admin).
- `src/pages/admin/SeasonDetailPage.tsx` — header + Edit + Leagues table + actions.
- `src/components/ui/dialog.tsx` — a shadcn/**radix** Dialog primitive (imported
  from the existing `radix-ui` package — **no new dependency**). Reused by all
  modals below.
- `src/pages/admin/SeasonFormDialog.tsx` — create/edit season modal (shared form;
  `year` is create-only, disabled on edit). Fields: year, status (select),
  `playoff_field_per_league` (number), `nfl_playoff_weeks` (comma-separated week
  list parsed to `number[]`). `scoring_ruleset_id` is **omitted** (backend defaults
  it). Surfaces the **409** duplicate-year error inline.
- `src/pages/admin/AddLeagueDialog.tsx` — Sleeper-ID input → async → result view:
  "Added" + scoring `✓ valid` / `⚠ scoring differs` + a diffs table
  (Category / League / Platform) when `diffs` is non-empty, with copy that the
  league is added regardless (advisory flag; Resync after fixing). Reused by
  **Resync** (same response shape; title/trigger differ).
- `src/features/adminSeasons.ts` — the hooks above.
- `src/hooks/admin` or inline: small confirm for Delete (a lightweight confirm
  Dialog), and a Sync-now result surfaced inline/toast (`week`, `teams_synced`,
  `mismatches`).

### Season detail — Leagues table

Rows come from `SeasonDetail.leagues` (`name`, `scoring_validated`). The row shows
**✓ valid** / **⚠ unverified** from `scoring_validated`. Scoring **diff details**
are only available in the add/resync response (not persisted), so they appear in
that modal, not the row.

Per-row actions:
- **Sync now** — shown for all admins; **gated to seasons in `regular`/`playoffs`**
  (during `setup` it's hidden/disabled, since the backend 409s). Result shown
  inline (a small "Week N · 12 synced · 0 mismatches" note) or a toast.
- **Resync** *(super-admin)* — opens the Add-league result dialog in resync mode.
- **Delete** *(super-admin)* — confirm dialog → `DELETE`.

### FE-3a follow-up folded in (touched code)

Extract a single `adminSections` config (label + path + `superOnly`) consumed by
`AdminLayout` (nav), `AdminHome` (hub cards), and `routes.tsx` — the FE-3a review
flagged this gating as triplicated. Adding the real Seasons routes is the natural
moment. (The other FE-3a deferrals — responsive rail, aria-live — stay deferred
unless trivially in the way.)

## States & errors

- List/detail: layered `isPending` / `isError` / empty (reuse the public pattern).
- Season not found (`GET /seasons/:id` 404) → friendly not-found.
- Create season 409 → inline "A season for {year} already exists."
- Add league: async spinner in the modal; 422 → "Sleeper league not found"; 502 →
  "Sleeper upstream error — try again"; success → result view.
- Sync now: 409 → the backend message (setup/wrong-season); 422/502 handled.
- Delete: confirm required; on 204 the row disappears (invalidate).
- All buttons that a league-admin lacks permission for are **not rendered** for
  them (role check via `useAuth().role`).

## Testing (Vitest + RTL + MSW)

Add MSW handlers for the admin endpoints (success + the key error codes). Honor
the baked-in gotchas (`.env.test` absolute base URL, jsdom origin, `import type`).

- **SeasonsListPage:** lists seasons; super-admin sees "New season", league-admin
  does not; create modal happy path invalidates/refreshes; **409** duplicate-year
  shows inline.
- **SeasonDetailPage:** renders season header + leagues; Edit visible to
  super-admin only; league rows show ✓/⚠ from `scoring_validated`.
- **AddLeagueDialog:** happy path (validated) shows Added; a response with `diffs`
  renders the diff table; **422** shows the not-found error; the dialog is
  super-admin only.
- **Sync now:** result note renders (`teams_synced`, `mismatches`); hidden/disabled
  when season is in `setup`; shown for league-admin.
- **Delete:** confirm → row removed on success.
- **Role-awareness:** league-admin sees read views + Sync now, and none of
  New season / Edit / Add league / Resync / Delete.
- Chart-free; assert behavior (rendered rows, button presence by role, error text,
  cache-refresh via re-render), not mocks.

## Non-goals (deferred)

- **Team owner-mapping** (`GET/PATCH /admin/leagues/{id}/teams`) → FE-3c (needs
  owners). 
- **Bracket admin** (`/admin/seasons/{id}/bracket*`) → FE-3e.
- **Grant-based league filtering** for league-admins → when grants surface (FE-3d).
- **`scoring_ruleset_id` selection** in the season form → the backend defaults it;
  add later if a ruleset-management surface exists.
- **A per-league page** — actions stay inline on the season detail.

## Definition of done

- `frontend/`: `npm run build`, `npm test`, `npm run lint` all green.
- A super-admin can, entirely through the UI: create a season, add a Sleeper
  league (seeing scoring validation/diffs), sync it, and delete it — and the public
  dashboard/league pages reflect the changes.
- Role-aware: a league-admin sees read views + Sync now only.
- Human eyeball of the seasons/detail pages + the add-league modal in light + dark
  (needs the backend running + a real Sleeper league ID to exercise the async flow).
