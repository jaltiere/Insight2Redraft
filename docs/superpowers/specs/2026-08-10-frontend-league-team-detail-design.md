# FE-1b: League Detail + Team Detail — Design

Date: 2026-08-10
Track: Frontend (follows FE-0 scaffold, FE-1a theme, FE-1 dashboard)
Branch: `plan/frontend-league-team-detail`

## Goal

Build the two currently-404ing public pages the dashboard already links to:

1. **League detail** (`/leagues/:id`) — a full standings table for one league.
2. **Team detail** (`/teams/:id`) — one team's record plus a week-by-week
   points breakdown (bar chart + table).

Both consume public reads that already exist. This closes live broken links on
the dashboard (`LeagueStandingsCard`'s "View league →" and each owner/team row)
and puts the theme's dataviz palette (`--chart-1..5`, `--highlight`) to work for
the first time.

## Backend contract (already shipped — no backend changes)

`backend/app/api/leagues.py`, schemas in `backend/app/api/public_schemas.py`:

- `GET /leagues/{league_id}` → `LeagueDetail`
  - `id`, `name`, `season_id`, `season_year`, `scoring_validated`
  - `standings: TeamStanding[]` — **already sorted** by win% then points-for
    (desc). Each `TeamStanding`: `team_id`, `owner: OwnerRef | null`, `wins`,
    `losses`, `ties`, `points_for`, `points_against`, `league_finish: number | null`.
  - 404 `{"detail": "League not found"}` for unknown id.
- `GET /teams/{team_id}` → `TeamDetail`
  - `id`, `league_id`, `league_name`, `season_year`, `owner: OwnerRef | null`,
    `wins`, `losses`, `ties`, `points_for`, `points_against`,
    `league_finish: number | null`
  - `weekly_scores: WeeklyScoreEntry[]` — each `week`, `points`, `is_final`;
    ordered by week ascending.
  - 404 `{"detail": "Team not found"}` for unknown id.

`OwnerRef`: `id`, `first_name`, `last_name`, `display_name: string | null`,
`avatar_url: string | null`.

## Architecture

Two standalone route pages, each self-fetching its data — mirrors the existing
`DashboardPage` pattern. Chosen over a modal/drawer or inline row-expand because
real URLs are shareable/bookmarkable (this is a public stats site) and each page
stays a small, independently-testable unit consistent with the codebase.

### Types (`frontend/src/types/api.ts`)

Add, mirroring `public_schemas.py` field-for-field:

```ts
export interface WeeklyScoreEntry {
  week: number;
  points: number;
  is_final: boolean;
}

export interface TeamDetail {
  id: number;
  league_id: number;
  league_name: string;
  season_year: number;
  owner: OwnerRef | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
  weekly_scores: WeeklyScoreEntry[];
}
```

`LeagueDetail`, `TeamStanding`, `OwnerRef` already exist and are correct.

### Hooks (`frontend/src/features/`)

- `useLeague(id: number | null)` — `useQuery`, key **`["league", id]`**
  (deliberately the SAME key `useLeagues` already uses in
  `useSeasonDashboard.ts`), `queryFn: apiClient.get<LeagueDetail>(\`/leagues/${id}\`)`,
  `enabled: id !== null`. Sharing the key means a click from the dashboard has
  the league already cached → instant first paint.
- `useTeam(id: number | null)` — `useQuery`, key `["team", id]`,
  `apiClient.get<TeamDetail>(\`/teams/${id}\`)`, `enabled: id !== null`.

Placed in a new `features/useLeagueDetail.ts` (exports both), or alongside the
existing dashboard hooks — implementer's call, but keep `["league", id]` shared.

### Id parsing

Route param `id` is a string. Parse `const id = Number(useParams().id)`. If
`Number.isNaN(id)`, render the not-found state (do not fetch).

### Shared helpers (`frontend/src/features/standings.ts` — new)

Extract the two formatters currently inlined in `LeagueStandingsCard.tsx`:

```ts
export function ownerName(owner: OwnerRef | null): string;   // display_name ?? "First Last"; "—" if null
export function teamRecord(t: { wins; losses; ties }): string; // "W-L" or "W-L-T"
```

Refactor `LeagueStandingsCard` to import these (removes its dead `if (!s.owner)`
branch noted in the FE-1 tidy-up cluster). No behavior change to the card.

## League detail page (`/leagues/:id`)

- `PageHeader`: title = `league.name`; eyebrow = `Season {season_year}`; the
  `Scoring ✓` / `Unverified` badge (as on the card). A "← Back to dashboard"
  `Link` to `/`.
- **Full standings table** (all teams, not top-5). Columns:
  | # | Owner | Record | Points for | Points against | Finish |
  - `#`: rank by row index; rank 1 gets the filled primary badge (as the card
    does), others muted tabular-nums.
  - `Owner`: `<Link to={/owners/${owner.id}}>` showing `ownerName`; `—` (muted,
    non-link) when `owner` is null.
  - `Record`: `teamRecord`.
  - `Points for`: `PointsBar` (reused) with `max = Math.max(1, ...all PF)` +
    the numeric value, matching the card treatment.
  - `Points against`: numeric, tabular-nums.
  - `Finish`: a `Badge` when `league_finish != null` (e.g. "1st"/"2nd"/…),
    else `—`.
  - **Trailing action cell**: a `→` `<Link to={/teams/${team_id}}>` (aria-label
    "View team detail"). This keeps team-detail navigation and owner navigation
    as two separate links — **no nested `<a>`** (an accessibility anti-pattern).
- Responsive: the table lives in an `overflow-x-auto` wrapper so it scrolls on
  narrow screens rather than breaking the page.
- Semantic tokens only (no hardcoded colors), light + dark.

## Team detail page (`/teams/:id`)

- **Header block**: owner avatar (`<img>` if `avatar_url`, else initials/neutral
  placeholder) + owner name (`Link` to `/owners/:id`, `—` if null);
  `league_name` (`Link` to `/leagues/:id`); `season_year`; record (`teamRecord`);
  finish `Badge` when set. `StatChip`s (reused) for Points for / Points against.
- **Weekly bar chart** (built via the **dataviz skill** at implementation time):
  - Hand-rolled SVG/CSS bars — **no new charting dependency**.
  - One bar per `weekly_scores` entry; height ∝ `points` (scaled to max points).
  - Bar fill from the `--chart` palette; **non-final weeks (`is_final === false`)
    rendered in amber `--highlight`** and labeled "Live".
  - Week labels on the x-axis; value labels on/above bars.
  - Accessible: the chart has a role/`aria-label` summarizing it, and the table
    below carries the exact numbers (screen-reader path).
- **Weekly table** below the chart: | Week | Points | Status | where Status is
  "Final" or "Live" (`is_final`).
- **Empty** `weekly_scores` (regular season not yet scored) → "No weekly scores
  yet." (chart + table omitted).

## States & errors (layered, per the established pattern)

For each page:

1. Invalid id (`NaN`) → not-found state, no fetch.
2. `isPending` → loading text/skeleton.
3. `isError`:
   - `ApiError.status === 404` → friendly "League not found" / "Team not found"
     reusing the `NotFound` visual language (heading + back-to-dashboard link).
   - otherwise → "Couldn't load this league/team." (retryable feel, muted).
4. Success → the content above.

`apiClient` already throws `ApiError` with a numeric `status`, so the 404 branch
keys off that.

## Routing (`frontend/src/routes.tsx`)

Add two children to the pathless `PublicLayout` route, **before** the `*`
catch-all so it stays last:

```tsx
{ path: "leagues/:id", element: <LeagueDetailPage /> },
{ path: "teams/:id",   element: <TeamDetailPage /> },
```

## Testing (Vitest + RTL + MSW)

Honor the baked-in gotchas: `.env.test` absolute `VITE_API_BASE_URL` and the
matching `vite.config.ts` jsdom origin (so MSW relative handlers match);
`import type` for React types.

**League detail:**
- renders all standings rows from a mocked `GET /leagues/1`;
- owner cell links to `/owners/:id`; trailing action links to `/teams/:id`;
- null-owner row shows `—` and is not a link;
- 404 response → "League not found";
- invalid id (`/leagues/abc`) → not-found, no request;
- loading state renders before resolve.

**Team detail:**
- renders header (owner, league link, record) + chart + table from mocked
  `GET /teams/1`;
- a non-final week is flagged "Live";
- empty `weekly_scores` → "No weekly scores yet." (no chart);
- 404 → "Team not found".

Chart assertions are **behavioral** (correct number of bars, value/week labels
present, live-week flagged) — never pixel/geometry snapshots.

## Non-goals (deferred)

- **Playoff-field highlighting** in standings — would need an extra `GET
  /seasons/{id}` fetch for `playoff_field_per_league` (not on `LeagueDetail`).
  Deferred; revisit if desired.
- **Pagination / virtualization** — leagues are small (~10-14 teams); a plain
  table is fine.
- **The `/owners/:id` page itself** — that's FE-1c. Owner links here fall
  through to `NotFound` gracefully until then (same as today).

## Definition of done

- `frontend/`: `npm run build`, `npm test`, `npm run lint` all green.
- Both routes reachable from the dashboard with no 404.
- Human eyeball of both pages in light + dark (needs backend running + seeded
  for real data; else the loading/error/empty states show).
