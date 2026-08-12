# FE-1b: League Detail + Team Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public `/leagues/:id` (full standings) and `/teams/:id` (record + weekly-scores bar chart & table) pages the dashboard already links to.

**Architecture:** Two standalone route pages under `PublicLayout`, each self-fetching via a React Query hook (mirrors `DashboardPage`). Shared formatters are extracted into `features/standings.ts`; the weekly bar chart is a hand-rolled SVG/CSS component using the theme's `--chart`/`--highlight` tokens (no charting dependency).

**Tech Stack:** React 19, TypeScript 6, React Router v7 (`react-router-dom`), TanStack Query, Tailwind v4, Vitest + React Testing Library + MSW.

Spec: `docs/superpowers/specs/2026-08-10-frontend-league-team-detail-design.md`
Branch: `plan/frontend-league-team-detail` (already created).

## Global Constraints

- All frontend commands run against `frontend/` (e.g. `npm --prefix frontend test`). Gate per task: `npm --prefix frontend run build` + `npm --prefix frontend test` + `npm --prefix frontend run lint` all green.
- **Semantic tokens only** — no hardcoded colors. Must resolve in light AND dark. Valid utilities include `bg-primary`, `text-muted-foreground`, `bg-card`, `border`, `bg-highlight`, `text-highlight-foreground`, `bg-chart-1`..`bg-chart-5` (all wired in `src/index.css` via `@theme inline`).
- **No new dependencies.** The chart is hand-rolled.
- TypeScript 6: use `import type { ... }` for type-only imports (React types, API types). `paths` alias `@/` only (no `baseUrl`).
- Tests: MSW runs with `onUnhandledRequest: "error"` (`vitest.setup.ts`) — **every** request needs a handler. `.env.test` sets absolute `VITE_API_BASE_URL=http://localhost/api`; MSW handlers are registered under `/api/...`. Use `import type` for React types.
- Pages that read a route param wrap in `<MemoryRouter initialEntries={[...]}><Routes><Route path=... element=... /></Routes></MemoryRouter>` in tests so `useParams` resolves.
- Backend is already shipped — **no backend changes**. Contract per the spec.

---

### Task 1: Types, shared formatters, data hooks, MSW handler

Foundation with no page UI. Adds the FE types mirroring the backend, extracts the duplicated formatters (resolving the FE-1 tidy-up note), adds the two query hooks, and adds the `/api/teams/:id` mock handler used by later tasks.

**Files:**
- Modify: `frontend/src/types/api.ts` (append `WeeklyScoreEntry`, `TeamDetail`)
- Create: `frontend/src/features/standings.ts`
- Test: `frontend/src/features/standings.test.ts`
- Create: `frontend/src/features/useLeagueDetail.ts`
- Modify: `frontend/src/components/LeagueStandingsCard.tsx` (use shared helpers)
- Modify: `frontend/src/test/handlers.ts` (add `/api/teams/:id`)

**Interfaces:**
- Consumes: `OwnerRef`, `LeagueDetail`, `TeamStanding` (already in `types/api.ts`); `apiClient` from `@/lib/api-client`.
- Produces:
  - `WeeklyScoreEntry { week: number; points: number; is_final: boolean }`
  - `TeamDetail { id; league_id; league_name; season_year; owner: OwnerRef | null; wins; losses; ties; points_for; points_against; league_finish: number | null; weekly_scores: WeeklyScoreEntry[] }`
  - `ownerName(owner: OwnerRef | null): string`
  - `teamRecord(t: { wins: number; losses: number; ties: number }): string`
  - `ordinal(n: number): string`
  - `useLeague(id: number | null)` → React Query result of `LeagueDetail`, key `["league", id]`
  - `useTeam(id: number | null)` → React Query result of `TeamDetail`, key `["team", id]`

- [ ] **Step 1: Write the failing test for the formatters**

Create `frontend/src/features/standings.test.ts`:

```ts
import { expect, test } from "vitest";
import { ownerName, teamRecord, ordinal } from "./standings";
import type { OwnerRef } from "@/types/api";

const owner: OwnerRef = { id: 1, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null };

test("ownerName prefers display_name, falls back to first+last, dash when null", () => {
  expect(ownerName(owner)).toBe("Jack Altiere");
  expect(ownerName({ ...owner, display_name: "JackA" })).toBe("JackA");
  expect(ownerName(null)).toBe("—");
});

test("teamRecord shows ties only when present", () => {
  expect(teamRecord({ wins: 9, losses: 4, ties: 0 })).toBe("9-4");
  expect(teamRecord({ wins: 9, losses: 4, ties: 1 })).toBe("9-4-1");
});

test("ordinal formats English ordinals", () => {
  expect(ordinal(1)).toBe("1st");
  expect(ordinal(2)).toBe("2nd");
  expect(ordinal(3)).toBe("3rd");
  expect(ordinal(4)).toBe("4th");
  expect(ordinal(11)).toBe("11th");
  expect(ordinal(21)).toBe("21st");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/features/standings.test.ts`
Expected: FAIL — cannot resolve `./standings`.

- [ ] **Step 3: Create the formatters**

Create `frontend/src/features/standings.ts`:

```ts
import type { OwnerRef } from "@/types/api";

export function ownerName(owner: OwnerRef | null): string {
  if (!owner) return "—";
  return owner.display_name ?? `${owner.first_name} ${owner.last_name}`;
}

export function teamRecord(t: { wins: number; losses: number; ties: number }): string {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

export function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- src/features/standings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Append the new API types**

In `frontend/src/types/api.ts`, append after the existing `LeagueDetail` interface:

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

- [ ] **Step 6: Create the data hooks**

Create `frontend/src/features/useLeagueDetail.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { LeagueDetail, TeamDetail } from "@/types/api";

export function useLeague(id: number | null) {
  return useQuery({
    queryKey: ["league", id],
    queryFn: () => apiClient.get<LeagueDetail>(`/leagues/${id}`),
    enabled: id !== null,
  });
}

export function useTeam(id: number | null) {
  return useQuery({
    queryKey: ["team", id],
    queryFn: () => apiClient.get<TeamDetail>(`/teams/${id}`),
    enabled: id !== null,
  });
}
```

- [ ] **Step 7: Refactor `LeagueStandingsCard` to use the shared helpers**

In `frontend/src/components/LeagueStandingsCard.tsx`: delete the local `ownerName` and `record` functions, import the shared ones, and update the call sites. Replace the top of the file:

```tsx
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PointsBar } from "@/components/PointsBar";
import { ownerName, teamRecord } from "@/features/standings";
import type { LeagueDetail } from "@/types/api";

const TOP_N = 5;
```

(Remove the old `import type { ..., TeamStanding }` line and the two local functions.) Then change the record cell from `{record(s)}` to `{teamRecord(s)}`, and the owner cell text from `{ownerName(s)}` to `{ownerName(s.owner)}`. The `s.owner ?` gate around the `<Link>` stays.

- [ ] **Step 8: Add the `/api/teams/:id` MSW handler**

In `frontend/src/test/handlers.ts`, add to the `handlers` array (after the `/api/leagues/:id` handler):

```ts
  http.get("/api/teams/:id", ({ params }) => {
    const id = Number(params.id);
    return HttpResponse.json({
      id,
      league_id: 3,
      league_name: "Dynasty League",
      season_year: 2024,
      owner: { id: 301, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
      wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: 1,
      weekly_scores: [
        { week: 1, points: 120.5, is_final: true },
        { week: 2, points: 98.0, is_final: true },
        { week: 3, points: 110.2, is_final: false },
      ],
    });
  }),
```

- [ ] **Step 9: Run the full gate**

Run: `npm --prefix frontend test` then `npm --prefix frontend run build` then `npm --prefix frontend run lint`
Expected: all green (existing `LeagueStandingsCard.test.tsx` and `DashboardPage.test.tsx` still pass — the card refactor is behavior-preserving).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/features/standings.ts frontend/src/features/standings.test.ts frontend/src/features/useLeagueDetail.ts frontend/src/components/LeagueStandingsCard.tsx frontend/src/test/handlers.ts
git commit -m "feat(frontend): FE-1b foundation — TeamDetail types, standings helpers, league/team hooks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: League detail page + route

Full standings table at `/leagues/:id`, with layered loading/error/not-found states. Also extends `NotFound` to accept an optional title/message (reused by Task 3).

**Files:**
- Modify: `frontend/src/pages/NotFound.tsx` (optional `title`/`message` props)
- Create: `frontend/src/pages/LeagueDetailPage.tsx`
- Test: `frontend/src/pages/LeagueDetailPage.test.tsx`
- Modify: `frontend/src/routes.tsx` (add `leagues/:id` route)

**Interfaces:**
- Consumes: `useLeague` (Task 1), `ownerName`/`teamRecord`/`ordinal` (Task 1), `PageHeader`, `Badge`, `PointsBar`, `isApiError` from `@/lib/api-client`.
- Produces: `LeagueDetailPage` (default-less named export), route `/leagues/:id`.

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/pages/LeagueDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueDetailPage } from "./LeagueDetailPage";
import { server } from "@/test/server";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/leagues/:id" element={<LeagueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders the full standings with owner and team-detail links", async () => {
  renderAt("/leagues/3");
  expect(await screen.findByRole("heading", { name: "Dynasty League" })).toBeInTheDocument();
  expect(await screen.findByText("Jack Altiere")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jack Altiere" })).toHaveAttribute("href", "/owners/301");
  expect(screen.getByRole("link", { name: /view team detail/i })).toHaveAttribute("href", "/teams/31");
});

test("shows not-found on a 404", async () => {
  server.use(http.get("/api/leagues/:id", () => HttpResponse.json({ detail: "League not found" }, { status: 404 })));
  renderAt("/leagues/999");
  expect(await screen.findByText(/league not found/i)).toBeInTheDocument();
});
```

(The default `/api/leagues/:id` handler returns owner id `id*100+1` = 301 and team_id `id*10+1` = 31 for id 3.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/pages/LeagueDetailPage.test.tsx`
Expected: FAIL — cannot resolve `./LeagueDetailPage`.

- [ ] **Step 3: Extend `NotFound` with optional props**

Replace `frontend/src/pages/NotFound.tsx` body signature so it accepts optional overrides (defaults keep the existing catch-all behavior and its test green):

```tsx
import { Link } from "react-router-dom";

export function NotFound({
  title = "Page not found",
  message = "That page doesn't exist (yet).",
}: { title?: string; message?: string } = {}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        Back to seasons
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Create the league detail page**

Create `frontend/src/pages/LeagueDetailPage.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PointsBar } from "@/components/PointsBar";
import { Badge } from "@/components/ui/badge";
import { NotFound } from "@/pages/NotFound";
import { useLeague } from "@/features/useLeagueDetail";
import { ownerName, ordinal, teamRecord } from "@/features/standings";
import { isApiError } from "@/lib/api-client";

export function LeagueDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const q = useLeague(valid ? id : null);

  if (!valid) return <NotFound title="League not found" message="We couldn't find that league." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="League not found" message="We couldn't find that league." />;
    }
    return <p className="text-destructive">Couldn't load this league.</p>;
  }

  const league = q.data;
  const maxPf = Math.max(1, ...league.standings.map((s) => s.points_for));

  return (
    <div>
      <div className="mb-4">
        <Link to="/" className="text-sm text-primary hover:underline">← Back to dashboard</Link>
      </div>
      <PageHeader
        title={league.name}
        description={`Season ${league.season_year}`}
        actions={
          <Badge variant={league.scoring_validated ? "secondary" : "outline"}>
            {league.scoring_validated ? "Scoring ✓" : "Unverified"}
          </Badge>
        }
      />
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Record</th>
              <th className="px-4 py-2 font-medium">Points for</th>
              <th className="px-4 py-2 font-medium">Points against</th>
              <th className="px-4 py-2 font-medium">Finish</th>
              <th className="px-4 py-2"><span className="sr-only">Team detail</span></th>
            </tr>
          </thead>
          <tbody>
            {league.standings.map((s, i) => (
              <tr key={s.team_id} className={i === 0 ? "border-t bg-primary/5" : "border-t"}>
                <td className="px-4 py-2">
                  {i === 0 ? (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                  )}
                </td>
                <td className="px-4 py-2 font-medium">
                  {s.owner ? (
                    <Link to={`/owners/${s.owner.id}`} className="hover:text-primary hover:underline">{ownerName(s.owner)}</Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">{teamRecord(s)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <PointsBar value={s.points_for} max={maxPf} />
                    <span className="tabular-nums text-muted-foreground">{s.points_for.toLocaleString("en-US")}</span>
                  </div>
                </td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">{s.points_against.toLocaleString("en-US")}</td>
                <td className="px-4 py-2">
                  {s.league_finish != null ? (
                    <Badge variant="outline">{ordinal(s.league_finish)}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    to={`/teams/${s.team_id}`}
                    aria-label={`View team detail for ${ownerName(s.owner)}`}
                    className="text-primary hover:underline"
                  >
                    →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Register the route**

In `frontend/src/routes.tsx`: import the page and add the route **before** the `*` catch-all inside the `PublicLayout` children.

Add import: `import { LeagueDetailPage } from "@/pages/LeagueDetailPage";`

Add child (before `{ path: "*", element: <NotFound /> }`):
```tsx
      { path: "leagues/:id", element: <LeagueDetailPage /> },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix frontend test -- src/pages/LeagueDetailPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full gate**

Run: `npm --prefix frontend test` then `npm --prefix frontend run build` then `npm --prefix frontend run lint`
Expected: all green (including the existing `NotFound.test.tsx`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/NotFound.tsx frontend/src/pages/LeagueDetailPage.tsx frontend/src/pages/LeagueDetailPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-1b league detail page at /leagues/:id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Team detail page (header + weekly table) + route

The team page with owner/league header, PF/PA stat chips, and the weekly-scores table plus states. The bar chart is added in Task 4.

**Files:**
- Create: `frontend/src/pages/TeamDetailPage.tsx`
- Test: `frontend/src/pages/TeamDetailPage.test.tsx`
- Modify: `frontend/src/routes.tsx` (add `teams/:id` route)

**Interfaces:**
- Consumes: `useTeam` (Task 1), `ownerName`/`teamRecord`/`ordinal` (Task 1), `StatChip`, `Badge`, `NotFound`, `isApiError`.
- Produces: `TeamDetailPage` (named export), route `/teams/:id`.

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/pages/TeamDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { TeamDetailPage } from "./TeamDetailPage";
import { server } from "@/test/server";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teams/:id" element={<TeamDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders owner header, league link, record, and the weekly table", async () => {
  renderAt("/teams/31");
  expect(await screen.findByRole("heading", { name: "Jack Altiere" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dynasty League" })).toHaveAttribute("href", "/leagues/3");
  expect(screen.getByText("11-2")).toBeInTheDocument();
  // week rows present (weeks 1,2,3 from the mock)
  expect(screen.getByText("120.5")).toBeInTheDocument();
});

test("flags a non-final week as Live", async () => {
  renderAt("/teams/31");
  expect(await screen.findAllByText(/live/i)).not.toHaveLength(0);
});

test("shows empty state when there are no weekly scores", async () => {
  server.use(
    http.get("/api/teams/:id", () =>
      HttpResponse.json({
        id: 31, league_id: 3, league_name: "Dynasty League", season_year: 2024,
        owner: { id: 301, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
        wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, league_finish: null,
        weekly_scores: [],
      }),
    ),
  );
  renderAt("/teams/31");
  expect(await screen.findByText(/no weekly scores yet/i)).toBeInTheDocument();
});

test("shows not-found on a 404", async () => {
  server.use(http.get("/api/teams/:id", () => HttpResponse.json({ detail: "Team not found" }, { status: 404 })));
  renderAt("/teams/999");
  expect(await screen.findByText(/team not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/pages/TeamDetailPage.test.tsx`
Expected: FAIL — cannot resolve `./TeamDetailPage`.

- [ ] **Step 3: Create the team detail page (no chart yet)**

Create `frontend/src/pages/TeamDetailPage.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";
import { StatChip } from "@/components/StatChip";
import { Badge } from "@/components/ui/badge";
import { NotFound } from "@/pages/NotFound";
import { useTeam } from "@/features/useLeagueDetail";
import { ownerName, ordinal, teamRecord } from "@/features/standings";
import { isApiError } from "@/lib/api-client";

export function TeamDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const q = useTeam(valid ? id : null);

  if (!valid) return <NotFound title="Team not found" message="We couldn't find that team." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Team not found" message="We couldn't find that team." />;
    }
    return <p className="text-destructive">Couldn't load this team.</p>;
  }

  const team = q.data;

  return (
    <div>
      <div className="mb-4">
        <Link to={`/leagues/${team.league_id}`} className="text-sm text-primary hover:underline">
          ← {team.league_name}
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-4">
        {team.owner?.avatar_url ? (
          <img src={team.owner.avatar_url} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {team.owner ? ownerName(team.owner).slice(0, 1) : "—"}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {team.owner ? (
              <Link to={`/owners/${team.owner.id}`} className="hover:text-primary hover:underline">{ownerName(team.owner)}</Link>
            ) : (
              "—"
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Season {team.season_year} · {teamRecord(team)}
            {team.league_finish != null ? ` · Finished ${ordinal(team.league_finish)}` : ""}
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatChip>{team.points_for.toLocaleString("en-US")} PF</StatChip>
        <StatChip>{team.points_against.toLocaleString("en-US")} PA</StatChip>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Weekly scores</h2>
      {team.weekly_scores.length === 0 ? (
        <p className="text-muted-foreground">No weekly scores yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Week</th>
                <th className="px-4 py-2 font-medium">Points</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {team.weekly_scores.map((w) => (
                <tr key={w.week} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{w.week}</td>
                  <td className="px-4 py-2 tabular-nums">{w.points.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2">
                    {w.is_final ? (
                      <span className="text-muted-foreground">Final</span>
                    ) : (
                      <Badge className="bg-highlight text-highlight-foreground">Live</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register the route**

In `frontend/src/routes.tsx`: add import `import { TeamDetailPage } from "@/pages/TeamDetailPage";` and a child **before** the `*` catch-all:
```tsx
      { path: "teams/:id", element: <TeamDetailPage /> },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend test -- src/pages/TeamDetailPage.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full gate**

Run: `npm --prefix frontend test` then `npm --prefix frontend run build` then `npm --prefix frontend run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/TeamDetailPage.tsx frontend/src/pages/TeamDetailPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-1b team detail page at /teams/:id (header + weekly table)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Weekly bar chart

Add the hand-rolled bar chart above the weekly table on the team page. **Before writing the chart, invoke the `dataviz` skill** to confirm palette usage, contrast, and mark/legend conventions — then implement per this task.

**Files:**
- Create: `frontend/src/components/WeeklyBarChart.tsx`
- Test: `frontend/src/components/WeeklyBarChart.test.tsx`
- Modify: `frontend/src/pages/TeamDetailPage.tsx` (render the chart when scores exist)
- Modify: `frontend/src/pages/TeamDetailPage.test.tsx` (assert the chart renders)

**Interfaces:**
- Consumes: `WeeklyScoreEntry` (Task 1).
- Produces: `WeeklyBarChart({ scores }: { scores: WeeklyScoreEntry[] })`.

- [ ] **Step 1: Invoke the dataviz skill**

Call the `dataviz` skill and read its guidance for a small categorical bar chart before writing chart code. Keep bars on `--chart-1`; use `--highlight` (amber) only for the non-final "Live" bars, matching the theme intent.

- [ ] **Step 2: Write the failing chart test**

Create `frontend/src/components/WeeklyBarChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WeeklyBarChart } from "./WeeklyBarChart";

const scores = [
  { week: 1, points: 120.5, is_final: true },
  { week: 2, points: 98.0, is_final: true },
  { week: 3, points: 110.2, is_final: false },
];

test("renders one labeled bar per week with rounded value labels", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByText("W1")).toBeInTheDocument();
  expect(screen.getByText("W2")).toBeInTheDocument();
  expect(screen.getByText("W3")).toBeInTheDocument();
  expect(screen.getByText("121")).toBeInTheDocument(); // Math.round(120.5)
});

test("flags the non-final week as live for screen readers", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByText(/week 3 \(live\)/i)).toBeInTheDocument();
});

test("exposes an accessible summary label", () => {
  render(<WeeklyBarChart scores={scores} />);
  expect(screen.getByRole("img", { name: /weekly points/i })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix frontend test -- src/components/WeeklyBarChart.test.tsx`
Expected: FAIL — cannot resolve `./WeeklyBarChart`.

- [ ] **Step 4: Create the chart component**

Create `frontend/src/components/WeeklyBarChart.tsx`:

```tsx
import type { WeeklyScoreEntry } from "@/types/api";

export function WeeklyBarChart({ scores }: { scores: WeeklyScoreEntry[] }) {
  const max = Math.max(1, ...scores.map((s) => s.points));
  const first = scores[0]?.week;
  const last = scores[scores.length - 1]?.week;

  return (
    <div
      role="img"
      aria-label={`Weekly points, weeks ${first} to ${last}`}
      className="flex items-end gap-2 overflow-x-auto rounded-xl border bg-card p-4 shadow-sm"
    >
      {scores.map((s) => {
        const heightPct = Math.max(4, (s.points / max) * 100);
        return (
          <div key={s.week} className="flex min-w-8 flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">{Math.round(s.points)}</span>
            <div className="flex h-40 w-full items-end">
              <div
                className={`w-full rounded-t ${s.is_final ? "bg-chart-1" : "bg-highlight"}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              W{s.week}
              {!s.is_final && <span className="sr-only"> — week {s.week} (live)</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix frontend test -- src/components/WeeklyBarChart.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Render the chart on the team page**

In `frontend/src/pages/TeamDetailPage.tsx`:
- add import `import { WeeklyBarChart } from "@/components/WeeklyBarChart";`
- inside the `weekly_scores.length === 0 ? ... : (...)` non-empty branch, render the chart above the table. Change the non-empty branch to a fragment:

```tsx
      ) : (
        <div className="space-y-4">
          <WeeklyBarChart scores={team.weekly_scores} />
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            {/* ...existing weekly table unchanged... */}
          </div>
        </div>
      )}
```

- [ ] **Step 7: Assert the chart in the team page test**

In `frontend/src/pages/TeamDetailPage.test.tsx`, extend the first test to confirm the chart mounts:

```tsx
  expect(await screen.findByRole("img", { name: /weekly points/i })).toBeInTheDocument();
```

- [ ] **Step 8: Run the full gate**

Run: `npm --prefix frontend test` then `npm --prefix frontend run build` then `npm --prefix frontend run lint`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/WeeklyBarChart.tsx frontend/src/components/WeeklyBarChart.test.tsx frontend/src/pages/TeamDetailPage.tsx frontend/src/pages/TeamDetailPage.test.tsx
git commit -m "feat(frontend): FE-1b weekly bar chart on team detail (chart palette + live highlight)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`CHOKIDAR_USEPOLLING=true npm --prefix frontend run dev -- --host`) against a running+seeded backend; verify `/leagues/:id` and `/teams/:id` in light AND dark — table readability, PointsBar, the "Live" amber badge, and the bar chart (chart-1 bars + amber live bar, contrast in both themes).
- **PR:** open a PR from `plan/frontend-league-team-detail` → `main` per [[git-workflow]]. No sensitive data in the PR.

## Self-review notes (author check)

- Spec coverage: types+hooks+helpers (Task 1); `/leagues/:id` full table with owner + team links, finish badge, states, route (Task 2); `/teams/:id` header + PF/PA chips + weekly table + empty/404/loading + route (Task 3); bar chart with `--chart`/`--highlight` + a11y (Task 4). Non-goals (playoff-field highlight, pagination, `/owners/:id`) intentionally excluded.
- Type consistency: `ownerName`/`teamRecord`/`ordinal`, `useLeague`/`useTeam`, `WeeklyScoreEntry`/`TeamDetail`, and route paths are named identically everywhere they appear.
- No placeholders: every code step shows full code; every run step shows the command + expected result.
