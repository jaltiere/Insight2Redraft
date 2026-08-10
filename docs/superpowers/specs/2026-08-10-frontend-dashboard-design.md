# Public Site: Season Dashboard + Routing Foundation (FE-1) — Design

**Date:** 2026-08-10
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

The first real public page: a **season dashboard** landing page (season status +
per-league standings snapshots) that replaces the bare seasons list, with the
fuller-color look approved via live mockup (a **blue masthead**, tinted page
background, blue-accented cards, a highlighted leader row, points-for bars).
Since this adds the first real routes, it also lands the routing foundation —
a **404 page**, a top-level **error boundary**, and a **mobile nav**.

This is the first of the decomposed public-site (FE-1) cycles:

- **FE-1 (this spec)** — season dashboard + routing foundation + shell recolor.
- **FE-1b (later)** — league detail page.
- **FE-1c (later)** — owner profile page.
- **Hall of Fame / Records** — deferred: no backend aggregation endpoint exists
  yet (needs a small backend cycle first).
- **FE-2** — super-bracket view. **FE-3** — admin area.

## Decisions (settled)

- Fuller-color direction (chosen from a live mockup): **blue masthead**, tinted
  page bg, blue-accented card headers, colored status badge, highlighted leader
  row, blue points-for bars — evolving the FE-1a theme, not replacing it (same
  tokens).
- Dashboard **lands on the latest season**; a **client-side season switcher**
  changes the shown season (deep-linkable `/seasons/:id` URLs deferred).
- Owner names and "View league" **link to `/owners/:id` and `/leagues/:id`**,
  which 404 gracefully via the new 404 page until FE-1b/FE-1c ship.

## Goals

- Recolor `PublicLayout` into the blue-masthead + tinted-bg shell (applies to all
  public pages).
- A season dashboard at `/`: season header + status + switcher, stat chips, a
  playoffs→bracket teaser, and per-league standings-snapshot cards.
- Routing foundation: catch-all 404, top-level error boundary, mobile nav.
- Loading skeletons + themed error states; all gates green.

## Non-Goals (this cycle)

- No league detail, owner profile, or records pages (FE-1b/FE-1c/backend).
- No bracket view (FE-2) — only a teaser link during playoffs.
- No deep-linkable per-season URLs (client-side switcher for now).
- No new backend endpoints — consumes existing public reads.

## Backend Contract (grounding — all merged)

- `GET /seasons` → `[{id, year, status}]` (`SeasonSummary`).
- `GET /seasons/{id}` → `SeasonDetail {id, year, status,
  playoff_field_per_league, nfl_playoff_weeks, leagues: [{id, name,
  scoring_validated}]}`.
- `GET /leagues/{id}` → `LeagueDetail {id, name, season_id, season_year,
  scoring_validated, standings: [TeamStanding]}` where `TeamStanding {team_id,
  owner: {id, first_name, last_name, display_name, avatar_url} | null, wins,
  losses, ties, points_for: number, points_against: number, league_finish:
  number | null}`. Standings come pre-sorted by the backend (regular-season
  order); the dashboard renders the top N as-is.
- Season `status` ∈ `setup | regular | playoffs | complete`.

## App Shell Recolor (`src/layouts/PublicLayout.tsx`)

- Header → a **blue masthead**: `bg-primary text-primary-foreground`, wordmark
  (links home), the nav (`NavLink`s with an active/inactive treatment on the blue
  bar), and the `ThemeToggle` at the right. Nav collapses to a hamburger on small
  screens (see Mobile nav).
- Page background → a subtle tint (`bg-muted/40` or similar) so `bg-card`
  surfaces stand out; constrained container (`max-w-6xl`); footer unchanged
  (or lightly restyled). Works in light and dark (semantic tokens only).

## Season Dashboard (`src/pages/DashboardPage.tsx`, route `/`)

Replaces `SeasonsPage` as the index route.

- **Load** `GET /seasons`; default the selected season to the latest year. A
  **season switcher** (a `Select`) lists all years and updates client state.
- **Load** `GET /seasons/{selectedId}` for the season's leagues, then
  `GET /leagues/{id}` for each league (parallel React-Query fetches, e.g.
  `useQueries`) to get standings.
- **Season header:** `Season {year}` + a **status Badge** (color per status),
  the switcher; **stat chips** (league count, team count, and the current NFL
  week if derivable — else omit); during `playoffs`/`complete`, a
  **"Playoffs are live → view the bracket"** link (to `/seasons/{id}/bracket`,
  which FE-2 builds).
- **Per-league cards** (`LeagueStandingsCard`): a blue-tinted header (league name
  + a "Scoring ✓"/"unverified" badge from `scoring_validated`), then a compact
  standings snapshot (top ~5): rank (leader gets a blue chip + tinted row), owner
  name (`display_name` or `first_name last_name`, linking `/owners/{owner.id}`;
  plain text if `owner` is null), record (`W-L[-T]`), and a **points-for bar**
  (`PointsBar`, width relative to the max PF in that league) + the PF value. A
  **"View league →"** link to `/leagues/{id}`.
- **States:** skeletons while loading; a themed error state if `/seasons` or a
  league fetch fails; an empty state if there are no seasons/leagues.

## Routing Foundation

- **404** (`src/pages/NotFound.tsx`): a themed not-found page (inside
  `PublicLayout`) with a link home; a catch-all `{ path: "*" }` route.
- **Error boundary** (`src/components/ErrorBoundary.tsx`): a class component
  catching render errors, rendering a friendly fallback (message + a reload/home
  action) instead of a blank screen; wraps the routed app (in `main.tsx` or as
  the router root). Keeps a component crash from taking down the whole app.
- **Mobile nav:** the masthead nav is hidden below `sm` and replaced by a
  hamburger button toggling a simple menu (a `Sheet`/dropdown or a disclosure
  panel) listing the nav links + the theme toggle.

## Reusable Primitives

`LeagueStandingsCard`, `StatChip`, `PointsBar`, `NotFound`, `ErrorBoundary`,
and a `Select` (shadcn add) — building blocks FE-1b/FE-1c/FE-2 reuse. New
response types in `src/types/api.ts`: `SeasonDetail`, `LeagueSummary`,
`LeagueDetail`, `TeamStanding`, `OwnerRef`.

## Testing Strategy

Vitest + RTL + MSW (mock `/seasons`, `/seasons/:id`, `/leagues/:id`). No live
backend.

- **Dashboard:** renders the latest season by default with its per-league
  standings cards (leader highlighted, owner + record + PF shown); the season
  switcher changes the displayed season (re-fetches); loading skeletons appear;
  an error state shows when a fetch fails; a null owner renders as plain text
  (no crash).
- **Routing:** an unknown path renders the 404 page; the error boundary catches a
  thrown error and shows the fallback (not a blank screen).
- **Mobile nav:** the hamburger toggles the menu; links are present.
- **Regression:** the FE-1a theme tests and the auth/login tests stay green
  (the login page still works under the recolored shell).
- Gates: `npm run build`, `npm test`, `npm run lint` all pass.

## Files

- Modify: `src/layouts/PublicLayout.tsx` (masthead + mobile nav), `src/routes.tsx`
  (dashboard index, 404 catch-all), `src/main.tsx` (error boundary), `src/types/
  api.ts` (new types), and remove/replace `src/pages/SeasonsPage.tsx`
  (+ its test) with the dashboard.
- Create: `src/pages/DashboardPage.tsx`, `src/pages/NotFound.tsx`,
  `src/components/ErrorBoundary.tsx`, `src/components/LeagueStandingsCard.tsx`,
  `src/components/StatChip.tsx`, `src/components/PointsBar.tsx`,
  `src/features/useSeasonDashboard.ts` (query hooks), shadcn `select` (and
  `sheet` if used for mobile nav), and tests.

## Constraints

- All frontend commands from `frontend/`. Node 22 / npm 10. Tests = Vitest, no
  backend. Type-safe; no `any` on API boundaries.
- Semantic tokens only — no hardcoded colors — so light and dark both work; reuse
  the FE-1a tokens (`--primary`, `--muted`, `--card`, `--highlight`, `--chart-*`).
- Keep the FE-0/FE-1a infra (absolute `.env.test`, `jsdom.url`, matchMedia
  polyfill, type-only imports).
- Accessibility: nav + switcher + hamburger keyboard-operable and labeled; the
  leader/PF signals are not color-only (rank number + PF value are text).
- Known good baseline: FE-1a `npm test` green — keep it green.
- Dev note: Vite HMR is unreliable on `/mnt/d` (WSL) — run with
  `CHOKIDAR_USEPOLLING=true` or restart on edits.
