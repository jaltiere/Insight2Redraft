# Public Site: Season Dashboard + Routing Foundation (FE-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A season-dashboard landing page (status + per-league standings snapshots) in the approved fuller-color look, plus the routing foundation (404, error boundary, mobile nav) and a recolored blue-masthead app shell.

**Architecture:** Consumes existing public reads (`/seasons`, `/seasons/{id}`, `/leagues/{id}`) via TanStack Query. New presentational primitives (`LeagueStandingsCard`, `StatChip`, `PointsBar`), a themed `NotFound`, a top-level `ErrorBoundary`, and a mobile-nav'd blue masthead. Semantic tokens only (light + dark).

**Tech Stack:** the FE-0/FE-1a frontend (Vite 8, React 19, TS, Tailwind v4, shadcn/ui, React Router 7, TanStack Query, Vitest + RTL + MSW), lucide-react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-frontend-dashboard-design.md`. Deviations need sign-off.
- **All commands from `frontend/`.** Node 22 / npm 10. Tests = Vitest, no backend.
- Gate at the END of each task: `npm run build`, `npm test`, `npm run lint` all pass. Type-safe; **no `any` on API boundaries**.
- **Semantic tokens only** — no hardcoded colors (so light + dark both work): `bg-primary`, `text-primary-foreground`, `bg-muted`, `bg-card`, `text-muted-foreground`, `text-destructive`, `bg-primary/5`, `ring-border`, etc.
- Keep FE-0/FE-1a infra (absolute `.env.test`, `jsdom.url`, matchMedia polyfill, type-only imports; context objects in their own modules).
- No new shadcn components needed (a native `<select>` for the switcher; a simple disclosure for mobile nav). No backend changes.
- Dev note: Vite HMR is unreliable on `/mnt/d` (WSL) — run `npm run dev` with `CHOKIDAR_USEPOLLING=true` or restart after edits.

## File Structure

- Create: `src/components/ErrorBoundary.tsx`, `src/pages/NotFound.tsx`, `src/components/StatChip.tsx`, `src/components/PointsBar.tsx`, `src/components/LeagueStandingsCard.tsx`, `src/features/useSeasonDashboard.ts`, `src/pages/DashboardPage.tsx`, and their tests.
- Modify: `src/layouts/PublicLayout.tsx` (blue masthead + mobile nav), `src/routes.tsx` (404 catch-all, then index→dashboard), `src/main.tsx` (error boundary), `src/types/api.ts` (new types), `src/test/handlers.ts` (season/league handlers).
- Delete: `src/pages/SeasonsPage.tsx`, `src/pages/SeasonsPage.test.tsx` (replaced by the dashboard).

---

### Task 1: Routing foundation + shell recolor

**Files:**
- Create: `src/components/ErrorBoundary.tsx`, `src/components/ErrorBoundary.test.tsx`, `src/pages/NotFound.tsx`, `src/pages/NotFound.test.tsx`
- Modify: `src/layouts/PublicLayout.tsx`, `src/routes.tsx`, `src/main.tsx`

**Interfaces produced:** `<ErrorBoundary>` (class), `<NotFound/>`, the recolored `PublicLayout` (blue masthead + mobile nav), a `*` catch-all route.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ErrorBoundary.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

test("renders a fallback when a child throws", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  spy.mockRestore();
});

test("renders children when there is no error", () => {
  render(
    <ErrorBoundary>
      <p>ok</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("ok")).toBeInTheDocument();
});
```

Create `src/pages/NotFound.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { NotFound } from "./NotFound";

test("renders a 404 with a link home", () => {
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
  expect(screen.getByText("404")).toBeInTheDocument();
  expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /seasons/i })).toHaveAttribute("href", "/");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ErrorBoundary NotFound`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement `ErrorBoundary` and `NotFound`**

Create `src/components/ErrorBoundary.tsx`:

```tsx
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          <p className="text-sm text-muted-foreground">An unexpected error occurred.</p>
          <a href="/" className="text-sm font-medium text-primary hover:underline">
            Go home
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Create `src/pages/NotFound.tsx`:

```tsx
import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That page doesn't exist (yet).</p>
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        Back to seasons
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Recolor the shell + add mobile nav**

Overwrite `src/layouts/PublicLayout.tsx`:

```tsx
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { to: "/", label: "Seasons", end: true },
  { to: "/leagues", label: "Leagues" },
  { to: "/bracket", label: "Bracket" },
  { to: "/records", label: "Records" },
];

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-muted/40 text-foreground">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight" onClick={() => setMenuOpen(false)}>
              Insight2Redraft
            </Link>
            <nav className="hidden items-center gap-4 text-sm sm:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? "font-medium" : "text-primary-foreground/70 hover:text-primary-foreground"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              className="p-2 sm:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-primary-foreground/20 px-4 py-2 sm:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block py-2 text-sm ${isActive ? "font-medium" : "text-primary-foreground/80"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          Insight2Redraft — cross-league fantasy, one bracket.
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Wire the catch-all route + error boundary**

In `src/routes.tsx`, add the import and a catch-all as the LAST child of the `PublicLayout` route:

```tsx
import { NotFound } from "@/pages/NotFound";
```
```tsx
    children: [
      { index: true, element: <SeasonsPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "*", element: <NotFound /> },
    ],
```

In `src/main.tsx`, wrap the app in `ErrorBoundary` (outermost) — add the import and wrap:

```tsx
import { ErrorBoundary } from "@/components/ErrorBoundary";
```
```tsx
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
```

- [ ] **Step 6: Gates**

Run: `npm test` (ErrorBoundary + NotFound pass; existing theme/auth/seasons tests stay green), `npm run build`, `npm run lint`.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): blue-masthead shell + mobile nav, 404 + error boundary"
```

---

### Task 2: API types + dashboard data hooks + presentational primitives

**Files:**
- Modify: `src/types/api.ts`
- Create: `src/features/useSeasonDashboard.ts`, `src/components/StatChip.tsx`, `src/components/PointsBar.tsx`, `src/components/LeagueStandingsCard.tsx`, `src/components/LeagueStandingsCard.test.tsx`

**Interfaces:**
- Produces types `OwnerRef`, `LeagueSummary`, `SeasonDetail`, `TeamStanding`, `LeagueDetail`; hooks `useSeason(id)`, `useLeagues(ids)`; components `<StatChip>`, `<PointsBar>`, `<LeagueStandingsCard league>`.
- Consumes `apiClient`, the existing `useSeasons` (FE-0), `Badge`.

- [ ] **Step 1: Add the API types**

Append to `src/types/api.ts`:

```ts
export interface OwnerRef {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface LeagueSummary {
  id: number;
  name: string;
  scoring_validated: boolean;
}

export interface SeasonDetail {
  id: number;
  year: number;
  status: SeasonStatus;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
  leagues: LeagueSummary[];
}

export interface TeamStanding {
  team_id: number;
  owner: OwnerRef | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
}

export interface LeagueDetail {
  id: number;
  name: string;
  season_id: number;
  season_year: number;
  scoring_validated: boolean;
  standings: TeamStanding[];
}
```

- [ ] **Step 2: Add the query hooks**

Create `src/features/useSeasonDashboard.ts`:

```ts
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { LeagueDetail, SeasonDetail } from "@/types/api";

export function useSeason(seasonId: number | null) {
  return useQuery({
    queryKey: ["season", seasonId],
    queryFn: () => apiClient.get<SeasonDetail>(`/seasons/${seasonId}`),
    enabled: seasonId !== null,
  });
}

export function useLeagues(leagueIds: number[]) {
  return useQueries({
    queries: leagueIds.map((id) => ({
      queryKey: ["league", id],
      queryFn: () => apiClient.get<LeagueDetail>(`/leagues/${id}`),
    })),
  });
}
```

- [ ] **Step 3: Add `StatChip` and `PointsBar`**

Create `src/components/StatChip.tsx`:

```tsx
import type { ReactNode } from "react";

export function StatChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-card px-3 py-1 text-sm shadow-sm ring-1 ring-border">
      {children}
    </span>
  );
}
```

Create `src/components/PointsBar.tsx`:

```tsx
export function PointsBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 4: Write the failing `LeagueStandingsCard` test**

Create `src/components/LeagueStandingsCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueStandingsCard } from "./LeagueStandingsCard";
import type { LeagueDetail } from "@/types/api";

const league: LeagueDetail = {
  id: 3,
  name: "Dynasty League",
  season_id: 1,
  season_year: 2024,
  scoring_validated: true,
  standings: [
    {
      team_id: 10,
      owner: { id: 100, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
      wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: null,
    },
    {
      team_id: 11,
      owner: null,
      wins: 5, losses: 8, ties: 0, points_for: 1200, points_against: 1450, league_finish: null,
    },
  ],
};

function renderCard() {
  return render(
    <MemoryRouter>
      <LeagueStandingsCard league={league} />
    </MemoryRouter>,
  );
}

test("renders league name, owner link, record, and the view-league link", () => {
  renderCard();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jack Altiere" })).toHaveAttribute("href", "/owners/100");
  expect(screen.getByText("11-2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view league/i })).toHaveAttribute("href", "/leagues/3");
});

test("renders a null owner as a dash without crashing", () => {
  renderCard();
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});
```

- [ ] **Step 5: Implement `LeagueStandingsCard`**

Create `src/components/LeagueStandingsCard.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PointsBar } from "@/components/PointsBar";
import type { LeagueDetail, TeamStanding } from "@/types/api";

const TOP_N = 5;

function ownerName(s: TeamStanding): string {
  if (!s.owner) return "—";
  return s.owner.display_name ?? `${s.owner.first_name} ${s.owner.last_name}`;
}

function record(s: TeamStanding): string {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

export function LeagueStandingsCard({ league }: { league: LeagueDetail }) {
  const rows = league.standings.slice(0, TOP_N);
  const maxPf = Math.max(1, ...league.standings.map((s) => s.points_for));
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
        <h3 className="font-semibold text-primary">{league.name}</h3>
        <Badge variant={league.scoring_validated ? "secondary" : "outline"}>
          {league.scoring_validated ? "Scoring ✓" : "Unverified"}
        </Badge>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Record</th>
            <th className="px-4 py-2 font-medium">Points for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.team_id} className={i === 0 ? "border-t bg-primary/5" : "border-t"}>
              <td className="px-4 py-2">
                {i === 0 ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    1
                  </span>
                ) : (
                  <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                )}
              </td>
              <td className="px-4 py-2 font-medium">
                {s.owner ? (
                  <Link to={`/owners/${s.owner.id}`} className="hover:text-primary hover:underline">
                    {ownerName(s)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 tabular-nums">{record(s)}</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <PointsBar value={s.points_for} max={maxPf} />
                  <span className="tabular-nums text-muted-foreground">
                    {s.points_for.toLocaleString("en-US")}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t px-4 py-2 text-right">
        <Link to={`/leagues/${league.id}`} className="text-sm font-medium text-primary hover:underline">
          View league →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Gates**

Run: `npm test -- LeagueStandingsCard` (2 pass), then `npm test`, `npm run build`, `npm run lint`.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): dashboard types, season/league query hooks, standings card"
```

---

### Task 3: Dashboard page + swap the home route

**Files:**
- Create: `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`
- Modify: `src/routes.tsx` (index → dashboard), `src/test/handlers.ts` (season/league handlers)
- Delete: `src/pages/SeasonsPage.tsx`, `src/pages/SeasonsPage.test.tsx`

**Interfaces:** consumes `useSeasons` (FE-0), `useSeason`/`useLeagues` (Task 2), `LeagueStandingsCard`, `StatChip`, `Badge`. Produces `<DashboardPage/>` as the index route.

- [ ] **Step 1: Add MSW handlers for season detail + league detail**

Append to `src/test/handlers.ts` (inside the `handlers` array):

```ts
  http.get("/api/seasons/:id", ({ params }) =>
    HttpResponse.json({
      id: Number(params.id),
      year: 2024,
      status: "playoffs",
      playoff_field_per_league: 2,
      nfl_playoff_weeks: [15, 16, 17],
      leagues: [
        { id: 3, name: "Dynasty League", scoring_validated: true },
        { id: 4, name: "Redraft Kings", scoring_validated: true },
      ],
    }),
  ),
  http.get("/api/leagues/:id", ({ params }) => {
    const id = Number(params.id);
    return HttpResponse.json({
      id,
      name: id === 3 ? "Dynasty League" : "Redraft Kings",
      season_id: 1,
      season_year: 2024,
      scoring_validated: true,
      standings: [
        {
          team_id: id * 10 + 1,
          owner: { id: id * 100 + 1, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
          wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: null,
        },
        {
          team_id: id * 10 + 2,
          owner: { id: id * 100 + 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null },
          wins: 9, losses: 4, ties: 0, points_for: 1500, points_against: 1420, league_finish: null,
        },
      ],
    });
  }),
```

(The existing `/api/seasons` handler returns `[{id:1, year:2024, status:"regular"}, {id:2, year:2023, status:"complete"}]` — the dashboard picks the latest, 2024.)

- [ ] **Step 2: Write the failing dashboard test**

Create `src/pages/DashboardPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { server } from "@/test/server";

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("lands on the latest season and shows its league standings", async () => {
  renderDash();
  expect(await screen.findByText("Season 2024")).toBeInTheDocument();
  expect(await screen.findByText("Dynasty League")).toBeInTheDocument();
  expect(await screen.findByText("Redraft Kings")).toBeInTheDocument();
  expect((await screen.findAllByRole("link", { name: /view league/i })).length).toBe(2);
});

test("the season switcher changes the shown season", async () => {
  renderDash();
  await screen.findByText("Season 2024");
  await userEvent.selectOptions(screen.getByLabelText("Season"), "2023");
  expect(await screen.findByText("Season 2023")).toBeInTheDocument();
});

test("shows an error state when seasons fail to load", async () => {
  server.use(http.get("/api/seasons", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
  renderDash();
  expect(await screen.findByText(/couldn't load seasons/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- DashboardPage`
Expected: FAIL — `DashboardPage` doesn't exist.

- [ ] **Step 4: Implement `DashboardPage`**

Create `src/pages/DashboardPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { LeagueStandingsCard } from "@/components/LeagueStandingsCard";
import { StatChip } from "@/components/StatChip";
import { useSeasons } from "@/features/useSeasons";
import { useLeagues, useSeason } from "@/features/useSeasonDashboard";
import type { SeasonStatus } from "@/types/api";

const STATUS_LABEL: Record<SeasonStatus, string> = {
  setup: "Setup",
  regular: "Regular season",
  playoffs: "Playoffs",
  complete: "Complete",
};

export function DashboardPage() {
  const seasonsQ = useSeasons();
  const seasons = seasonsQ.data;
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const latestYear = useMemo(
    () => (seasons && seasons.length ? Math.max(...seasons.map((s) => s.year)) : null),
    [seasons],
  );
  const year = selectedYear ?? latestYear;
  const selected = seasons?.find((s) => s.year === year) ?? null;

  const seasonQ = useSeason(selected?.id ?? null);
  const leagues = seasonQ.data?.leagues ?? [];
  const leagueQs = useLeagues(leagues.map((l) => l.id));

  if (seasonsQ.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (seasonsQ.isError) return <p className="text-destructive">Couldn't load seasons.</p>;
  if (!seasons || seasons.length === 0 || !selected) {
    return <p className="text-muted-foreground">No seasons yet.</p>;
  }

  const teamCount = leagueQs.reduce((n, q) => n + (q.data?.standings.length ?? 0), 0);
  const showBracket = selected.status === "playoffs" || selected.status === "complete";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Season {selected.year}</h1>
            <Badge>{STATUS_LABEL[selected.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Standings across every league, at a glance.</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Season</span>
          <select
            aria-label="Season"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={selected.year}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.year}>
                {s.year}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatChip>
          {leagues.length} {leagues.length === 1 ? "league" : "leagues"}
        </StatChip>
        {teamCount > 0 && <StatChip>{teamCount} teams</StatChip>}
        {showBracket && (
          <Link
            to={`/seasons/${selected.id}/bracket`}
            className="rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            View the bracket →
          </Link>
        )}
      </div>

      {seasonQ.isPending ? (
        <p className="text-muted-foreground">Loading leagues…</p>
      ) : seasonQ.isError ? (
        <p className="text-destructive">Couldn't load this season.</p>
      ) : leagues.length === 0 ? (
        <p className="text-muted-foreground">No leagues in this season yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {leagueQs.map((q, i) =>
            q.data ? (
              <LeagueStandingsCard key={leagues[i].id} league={q.data} />
            ) : (
              <div
                key={leagues[i].id}
                className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
              >
                {q.isError ? `Couldn't load ${leagues[i].name}.` : `Loading ${leagues[i].name}…`}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Swap the home route + delete the old page**

In `src/routes.tsx`: replace the `SeasonsPage` import with `import { DashboardPage } from "@/pages/DashboardPage";`, and change the index element to `{ index: true, element: <DashboardPage /> }`.

Delete `src/pages/SeasonsPage.tsx` and `src/pages/SeasonsPage.test.tsx`.

- [ ] **Step 6: Run the dashboard tests, then the full suite + build + lint**

Run: `npm test -- DashboardPage` (3 pass).

Run: `npm test`
Expected: all pass (the removed SeasonsPage tests are gone; ErrorBoundary + NotFound + LeagueStandingsCard + DashboardPage + theme + auth + api-client + smoke).

Run: `npm run build && npm run lint`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): season dashboard as home page (standings snapshots)"
```

---

## Verification (whole branch)

- From `frontend/`: `npm test` (all green), `npm run build`, `npm run lint`.
- Manual smoke (needs the backend on :8000 for real data, else the dashboard shows its loading/error states): `npm run dev`, open `/` → blue masthead, the latest season with per-league standings cards (leader highlighted, points-for bars), the season switcher changes seasons; an unknown path (e.g. `/nope`) renders the 404 within the shell; the mobile hamburger toggles the nav on a narrow window; toggling light/dark recolors everything. If the backend isn't running, confirm the themed loading/error states instead.
