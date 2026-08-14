# FE-3b: Seasons & Leagues Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin UI to manage seasons (list/create/edit) and their leagues (add via Sleeper ID with scoring-diff review, resync-setup, sync-now, delete), role-aware — the slice that lets a super-admin seed the whole app through the UI.

**Architecture:** Reads reuse the existing public `/seasons` + `/seasons/{id}` queries; writes go through new admin mutation hooks (`features/adminSeasons.ts`) over an api-client extended with `patch`/`delete`. Modals use a new radix `Dialog` primitive. A shared `adminSections` config (resolving an FE-3a follow-up) drives nav/hub/routes.

**Tech Stack:** React 19, TypeScript 6, React Router v7, TanStack Query, Tailwind v4 (semantic tokens), radix-ui (already a dep), Vitest + RTL + MSW.

Spec: `docs/superpowers/specs/2026-08-12-frontend-seasons-leagues-admin-design.md`
Branch: `plan/fe-3b-seasons-leagues` (already created off `main`).

## Global Constraints

- All frontend commands run against `frontend/` (`npm --prefix frontend <...>`). Gate per task: `npm --prefix frontend run build` + `npm --prefix frontend test` + `npm --prefix frontend run lint` all green.
- **Semantic tokens only** — no hardcoded colors; must resolve light AND dark. Use `bg-card`, `border`, `text-primary`, `text-muted-foreground`, `text-destructive`, `bg-primary`, the `Button`/`Badge`/`Input` primitives, and (dialogs) `bg-black/50` for the overlay scrim only.
- **No new dependencies.** The Dialog uses the existing `radix-ui` package (`import { Dialog } from "radix-ui"`).
- TypeScript 6: `import type` for type-only imports; `@/` alias only.
- **Roles (mirror the backend):** super-admin = all writes; league-admin = read + **Sync now** only. Super-admin-only buttons are **not rendered** for league-admins (`useAuth().role === "super_admin"`). No grant-based filtering this slice.
- Tests: MSW `onUnhandledRequest: "error"` — every request needs a handler (Task 1 adds the admin handlers). Default `/api/auth/me` → super_admin; league_admin via `server.use` override. Route/param pages wrapped in `MemoryRouter`(+`Routes`/`Route`). `import type` for React types. **Dialogs must include a `DialogTitle` and `DialogDescription`** so radix emits no a11y console warnings (test output must stay pristine).
- **Commit hygiene:** the working tree has unrelated pending changes (`vite.config.ts`, `docs/local-dev.md`, `.claude/*`). Every commit stages ONLY its named files — never `git add -A`.
- No backend changes.

---

### Task 1: Foundation — api-client patch/delete, admin types, mutation hooks, Dialog primitive, MSW handlers

Plumbing with no page UI. Adds the write verbs, types, mutations, the reusable modal primitive, and the mock handlers all later tasks depend on.

**Files:**
- Modify: `frontend/src/lib/api-client.ts`
- Test: `frontend/src/lib/api-client.test.ts` (extend)
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/features/adminSeasons.ts`
- Create: `frontend/src/components/ui/dialog.tsx`
- Test: `frontend/src/components/ui/dialog.test.tsx`
- Modify: `frontend/src/test/handlers.ts`

**Interfaces:**
- Consumes: `apiClient`, `queryClient`, `useAuth`.
- Produces: `apiClient.patch`/`apiClient.delete`; types `SeasonAdminResponse`, `SeasonCreateBody`, `SeasonUpdateBody`, `ScoringDiff`, `LeagueSetupResponse`, `SyncNowResponse`; hooks `useCreateSeason`, `useUpdateSeason(id)`, `useAddLeague(seasonId)`, `useResyncLeague(seasonId)`, `useSyncLeague`, `useDeleteLeague(seasonId)`; Dialog primitives `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`.

- [ ] **Step 1: Write the failing api-client patch/delete test**

Add to `frontend/src/lib/api-client.test.ts` (reuse its existing MSW/server imports; match the file's style):

```ts
test("patch sends a PATCH and returns the body", async () => {
  server.use(http.patch("/api/admin/seasons/1", () => HttpResponse.json({ id: 1, year: 2025 })));
  const res = await apiClient.patch<{ id: number; year: number }>("/admin/seasons/1", { status: "regular" });
  expect(res).toEqual({ id: 1, year: 2025 });
});

test("delete sends a DELETE and resolves on 204", async () => {
  server.use(http.delete("/api/admin/leagues/9", () => new HttpResponse(null, { status: 204 })));
  await expect(apiClient.delete<void>("/admin/leagues/9")).resolves.toBeUndefined();
});
```

(If `http`/`HttpResponse`/`server` aren't already imported in this file, add them: `import { http, HttpResponse } from "msw";` and `import { server } from "@/test/server";`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/lib/api-client.test.ts -t "patch\|delete"`
Expected: FAIL — `apiClient.patch`/`apiClient.delete` are not functions.

- [ ] **Step 3: Add patch/delete to the api-client**

In `frontend/src/lib/api-client.ts`, extend the exported object (the private `request` already supports any method + 204):

```ts
export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/lib/api-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the admin types**

Append to `frontend/src/types/api.ts`:

```ts
export interface SeasonAdminResponse {
  id: number;
  year: number;
  status: SeasonStatus;
  scoring_ruleset_id: number | null;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
}

export interface SeasonCreateBody {
  year: number;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
  status: SeasonStatus;
}

export interface SeasonUpdateBody {
  playoff_field_per_league?: number;
  nfl_playoff_weeks?: number[];
  status?: SeasonStatus;
}

export interface ScoringDiff {
  category: string;
  league_value: number;
  platform_value: number;
}

export interface LeagueSetupResponse {
  league_id: number;
  name: string;
  scoring_validated: boolean;
  diffs: ScoringDiff[];
  teams: { team_id: number; sleeper_roster_id: number; sleeper_user_id: string | null }[];
}

export interface SyncNowResponse {
  league_id: number;
  week: number;
  teams_synced: number;
  rosters_skipped: number;
  mismatches: number;
}
```

- [ ] **Step 6: Create the mutation hooks**

Create `frontend/src/features/adminSeasons.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  LeagueSetupResponse,
  SeasonAdminResponse,
  SeasonCreateBody,
  SeasonUpdateBody,
  SyncNowResponse,
} from "@/types/api";

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeasonCreateBody) => apiClient.post<SeasonAdminResponse>("/admin/seasons", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seasons"] }),
  });
}

export function useUpdateSeason(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeasonUpdateBody) => apiClient.patch<SeasonAdminResponse>(`/admin/seasons/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["season", id] });
      qc.invalidateQueries({ queryKey: ["seasons"] });
    },
  });
}

export function useAddLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sleeperLeagueId: string) =>
      apiClient.post<LeagueSetupResponse>(`/admin/seasons/${seasonId}/leagues`, {
        sleeper_league_id: sleeperLeagueId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}

export function useResyncLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.post<LeagueSetupResponse>(`/admin/leagues/${leagueId}/resync-setup`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}

export function useSyncLeague() {
  return useMutation({
    mutationFn: (leagueId: number) => apiClient.post<SyncNowResponse>(`/admin/leagues/${leagueId}/sync`),
  });
}

export function useDeleteLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) => apiClient.delete<void>(`/admin/leagues/${leagueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}
```

- [ ] **Step 7: Write the failing Dialog test**

Create `frontend/src/components/ui/dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";

test("opens on trigger click and shows titled content", async () => {
  render(
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>My dialog</DialogTitle>
        <DialogDescription>Body</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("My dialog")).toBeInTheDocument();
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/components/ui/dialog.test.tsx`
Expected: FAIL — `./dialog` does not exist.

- [ ] **Step 9: Create the Dialog primitive**

Create `frontend/src/components/ui/dialog.tsx`:

```tsx
import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/components/ui/dialog.test.tsx`
Expected: PASS, no console warnings.

- [ ] **Step 11: Add MSW admin handlers**

In `frontend/src/test/handlers.ts`, add to the `handlers` array:

```ts
  // --- admin: seasons & leagues (FE-3b) ---
  http.post("/api/admin/seasons", async ({ request }) => {
    const body = (await request.json()) as { year: number };
    if (body.year === 2024) {
      return HttpResponse.json({ detail: "Season year already exists" }, { status: 409 });
    }
    return HttpResponse.json(
      { id: 99, year: body.year, status: "setup", scoring_ruleset_id: null, playoff_field_per_league: 2, nfl_playoff_weeks: [] },
      { status: 201 },
    );
  }),
  http.patch("/api/admin/seasons/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: Number(params.id), year: 2024, status: "regular", scoring_ruleset_id: null,
      playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], ...body,
    });
  }),
  http.post("/api/admin/seasons/:id/leagues", async ({ request }) => {
    const body = (await request.json()) as { sleeper_league_id: string };
    if (body.sleeper_league_id === "notfound") {
      return HttpResponse.json({ detail: "Sleeper league not found" }, { status: 422 });
    }
    const differs = body.sleeper_league_id === "diffs";
    return HttpResponse.json(
      {
        league_id: 5, name: "New League", scoring_validated: !differs,
        diffs: differs ? [{ category: "Pass TD", league_value: 6, platform_value: 4 }] : [],
        teams: [{ team_id: 51, sleeper_roster_id: 1, sleeper_user_id: "u1" }],
      },
      { status: 201 },
    );
  }),
  http.post("/api/admin/leagues/:id/resync-setup", ({ params }) =>
    HttpResponse.json({
      league_id: Number(params.id), name: "Dynasty League", scoring_validated: true, diffs: [],
      teams: [{ team_id: 31, sleeper_roster_id: 1, sleeper_user_id: "u1" }],
    }),
  ),
  http.post("/api/admin/leagues/:id/sync", ({ params }) =>
    HttpResponse.json({ league_id: Number(params.id), week: 14, teams_synced: 12, rosters_skipped: 0, mismatches: 0 }),
  ),
  http.delete("/api/admin/leagues/:id", () => new HttpResponse(null, { status: 204 })),
```

- [ ] **Step 12: Run the full gate**

Run: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/lib/api-client.ts frontend/src/lib/api-client.test.ts frontend/src/types/api.ts frontend/src/features/adminSeasons.ts frontend/src/components/ui/dialog.tsx frontend/src/components/ui/dialog.test.tsx frontend/src/test/handlers.ts
git commit -m "feat(frontend): FE-3b foundation — api-client patch/delete, admin season types + mutations, Dialog primitive, MSW handlers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Shared adminSections config + Seasons list page + create-season modal

Extract the triplicated nav/hub gating into one config (FE-3a follow-up), then build the seasons list and the create-season modal.

**Files:**
- Create: `frontend/src/features/adminSections.ts`
- Modify: `frontend/src/layouts/AdminLayout.tsx`
- Modify: `frontend/src/pages/admin/AdminHome.tsx`
- Create: `frontend/src/pages/admin/SeasonFormDialog.tsx`
- Create: `frontend/src/pages/admin/SeasonsListPage.tsx`
- Test: `frontend/src/pages/admin/SeasonsListPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useSeasons` (`@/features/useSeasons`), `useCreateSeason` (Task 1), `useAuth`, Dialog primitives, `Button`/`Input`.
- Produces: `adminSections` (array of `{ to, label, desc, superOnly? }`); `SeasonFormDialog` (create+edit modes); `SeasonsListPage`; route `/admin/seasons`.

- [ ] **Step 1: Create the shared sections config**

Create `frontend/src/features/adminSections.ts`:

```ts
export interface AdminSection {
  to: string;
  label: string;
  desc: string;
  superOnly?: boolean;
}

export const adminSections: AdminSection[] = [
  { to: "/admin/seasons", label: "Seasons", desc: "Create & edit seasons, add leagues, sync." },
  { to: "/admin/owners", label: "Owners", desc: "Owner records & per-team mapping." },
  { to: "/admin/accounts", label: "Accounts", desc: "League-admin accounts & league grants.", superOnly: true },
];

export function visibleSections(role: string | null): AdminSection[] {
  return adminSections.filter((s) => !s.superOnly || role === "super_admin");
}
```

- [ ] **Step 2: Refactor `AdminLayout` + `AdminHome` to consume it (keep their tests green)**

In `frontend/src/layouts/AdminLayout.tsx`, replace the local `NAV` with the shared config. The rail needs a "Home" item plus the sections:

```tsx
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { RolePill } from "@/components/RolePill";
import { visibleSections } from "@/features/adminSections";

export function AdminLayout() {
  const { account, role, logout } = useAuth();
  const items = [
    { to: "/admin", label: "Home", end: true },
    ...visibleSections(role).map((s) => ({ to: s.to, label: s.label, end: false })),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-admin-rail text-admin-rail-foreground">
        <div className="px-4 py-4 text-lg font-extrabold tracking-wide">
          I2R <span className="text-highlight">ADMIN</span>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-white/10"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start gap-2 border-t border-white/10 px-4 py-3 text-xs">
          <span className="max-w-full truncate opacity-80">{account?.email}</span>
          <RolePill role={role} />
          <button className="underline opacity-80 hover:opacity-100" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

In `frontend/src/pages/admin/AdminHome.tsx`, replace the local `SECTIONS` with the shared config:

```tsx
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { visibleSections } from "@/features/adminSections";

export function AdminHome() {
  const { account, role } = useAuth();
  const sections = visibleSections(role);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {account?.email}. Manage seasons, owners, and accounts.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary"
          >
            <h2 className="font-semibold text-primary">{s.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the existing shell/hub tests still pass**

Run: `npm --prefix frontend test -- src/layouts/AdminLayout.test.tsx src/pages/admin/AdminHome.test.tsx`
Expected: PASS (behavior unchanged; the AdminHome cards now read from `s.label`). If a test matched the old Seasons card text, it still matches ("Seasons" label + a desc); adjust only if a description string it asserted changed.

- [ ] **Step 4: Write the failing Seasons-list test**

Create `frontend/src/pages/admin/SeasonsListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonsListPage } from "./SeasonsListPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderPage() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuthProvider>
          <SeasonsListPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("lists seasons and shows New season for super-admin", async () => {
  renderPage();
  expect(await screen.findByRole("link", { name: /2024/ })).toHaveAttribute("href", "/admin/seasons/1");
  expect(screen.getByRole("button", { name: /new season/i })).toBeInTheDocument();
});

test("hides New season for a league-admin", async () => {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 })));
  renderPage();
  await screen.findByRole("link", { name: /2024/ });
  expect(screen.queryByRole("button", { name: /new season/i })).toBeNull();
});

test("creating a duplicate year shows the 409 inline", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /new season/i }));
  await userEvent.clear(screen.getByLabelText(/year/i));
  await userEvent.type(screen.getByLabelText(/year/i), "2024");
  await userEvent.click(screen.getByRole("button", { name: /create/i }));
  expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
});
```

(The default `/api/seasons` handler returns years 2024 (id 1) and 2023 (id 2); the `POST /api/admin/seasons` handler 409s on year 2024.)

- [ ] **Step 5: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonsListPage.test.tsx`
Expected: FAIL — `./SeasonsListPage` does not exist.

- [ ] **Step 6: Create the season form dialog (create + edit modes)**

Create `frontend/src/pages/admin/SeasonFormDialog.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateSeason, useUpdateSeason } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { SeasonDetail, SeasonStatus } from "@/types/api";

const STATUSES: SeasonStatus[] = ["setup", "regular", "playoffs", "complete"];

function parseWeeks(s: string): number[] {
  return s.split(",").map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

export function SeasonFormDialog({ trigger, season }: { trigger: ReactNode; season?: SeasonDetail }) {
  const editing = season !== undefined;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(season ? String(season.year) : "");
  const [status, setStatus] = useState<SeasonStatus>(season?.status ?? "setup");
  const [field, setField] = useState(String(season?.playoff_field_per_league ?? 2));
  const [weeks, setWeeks] = useState((season?.nfl_playoff_weeks ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSeason();
  const update = useUpdateSeason(season?.id ?? 0);
  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          status,
          playoff_field_per_league: Number(field),
          nfl_playoff_weeks: parseWeeks(weeks),
        });
      } else {
        await create.mutateAsync({
          year: Number(year),
          status,
          playoff_field_per_league: Number(field),
          nfl_playoff_weeks: parseWeeks(weeks),
        });
      }
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Save failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit season ${season.year}` : "New season"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update this season's settings." : "Create a season, then add its leagues."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Year</span>
            <Input value={year} disabled={editing} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              className="rounded-md border bg-background px-2 py-1"
              value={status}
              onChange={(e) => setStatus(e.target.value as SeasonStatus)}
            >
              {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Playoff teams per league</span>
            <Input value={field} onChange={(e) => setField(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">NFL playoff weeks</span>
            <Input value={weeks} placeholder="15, 16, 17" onChange={(e) => setWeeks(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={pending}>{editing ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Create the Seasons list page**

Create `frontend/src/pages/admin/SeasonsListPage.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useSeasons } from "@/features/useSeasons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeasonFormDialog } from "./SeasonFormDialog";

export function SeasonsListPage() {
  const { role } = useAuth();
  const q = useSeasons();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Seasons</h1>
        {role === "super_admin" && (
          <SeasonFormDialog trigger={<Button>New season</Button>} />
        )}
      </div>
      {q.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-destructive">Couldn't load seasons.</p>
      ) : q.data.length === 0 ? (
        <p className="text-muted-foreground">No seasons yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((s) => (
            <li key={s.id}>
              <Link
                to={`/admin/seasons/${s.id}`}
                className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary"
              >
                <span className="font-semibold">{s.year}</span>
                <Badge variant="secondary">{s.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Wire the route (replace the Seasons stub)**

In `frontend/src/routes.tsx`: import `SeasonsListPage` and replace the `{ path: "seasons", element: <AdminSectionStub title="Seasons" /> }` child with `{ path: "seasons", element: <SeasonsListPage /> }`. Leave Owners/Accounts stubs and everything else intact.

- [ ] **Step 9: Run the tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonsListPage.test.tsx`
Expected: PASS (3 tests).
Then: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/adminSections.ts frontend/src/layouts/AdminLayout.tsx frontend/src/pages/admin/AdminHome.tsx frontend/src/pages/admin/SeasonFormDialog.tsx frontend/src/pages/admin/SeasonsListPage.tsx frontend/src/pages/admin/SeasonsListPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3b seasons list + create modal + shared adminSections config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Season detail page + edit-season modal + leagues table + route

**Files:**
- Create: `frontend/src/pages/admin/SeasonDetailPage.tsx`
- Test: `frontend/src/pages/admin/SeasonDetailPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useSeason` (`@/features/useSeasonDashboard`), `useAuth`, `SeasonFormDialog` (Task 2), `Badge`/`Button`, `isApiError`.
- Produces: `SeasonDetailPage`; route `/admin/seasons/:id`. Renders a `<LeaguesTable>` region (read-only rows here; actions added in Tasks 4–5) — keep the league-row markup in this file so Tasks 4/5 extend it.

- [ ] **Step 1: Write the failing detail test**

Create `frontend/src/pages/admin/SeasonDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonDetailPage } from "./SeasonDetailPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/1", role = "super_admin") {
  localStorage.setItem("i2r_token", "tok.123");
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes><Route path="/admin/seasons/:id" element={<SeasonDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders the season header and its leagues", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /season 2024/i })).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByText("Redraft Kings")).toBeInTheDocument();
});

test("Edit is shown for super-admin, hidden for league-admin", async () => {
  renderAt("/admin/seasons/1", "super_admin");
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
});

test("league-admin does not see Edit", async () => {
  renderAt("/admin/seasons/1", "league_admin");
  await screen.findByRole("heading", { name: /season 2024/i });
  expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
});
```

(The default `/api/seasons/:id` handler returns status "playoffs" with leagues Dynasty League + Redraft Kings.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonDetailPage.test.tsx`
Expected: FAIL — `./SeasonDetailPage` does not exist.

- [ ] **Step 3: Create the season detail page**

Create `frontend/src/pages/admin/SeasonDetailPage.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useSeason } from "@/features/useSeasonDashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFound } from "@/pages/NotFound";
import { SeasonFormDialog } from "./SeasonFormDialog";
import { isApiError } from "@/lib/api-client";

export function SeasonDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const { role } = useAuth();
  const q = useSeason(valid ? id : null);

  if (!valid) return <NotFound title="Season not found" message="We couldn't find that season." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Season not found" message="We couldn't find that season." />;
    }
    return <p className="text-destructive">Couldn't load this season.</p>;
  }

  const season = q.data;
  const isSuper = role === "super_admin";

  return (
    <div>
      <div className="mb-1"><Link to="/admin/seasons" className="text-sm text-primary hover:underline">← Seasons</Link></div>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Season {season.year}</h1>
        <Badge variant="secondary">{season.status}</Badge>
        {isSuper && (
          <span className="ml-auto">
            <SeasonFormDialog season={season} trigger={<Button variant="outline">Edit</Button>} />
          </span>
        )}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {season.playoff_field_per_league} playoff / league
        {season.nfl_playoff_weeks.length > 0 && <> · weeks {season.nfl_playoff_weeks.join(", ")}</>}
      </p>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Leagues ({season.leagues.length})</h2>
        {/* Task 4 adds the Add-league button here */}
      </div>
      {season.leagues.length === 0 ? (
        <p className="text-muted-foreground">No leagues yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">League</th>
                <th className="px-4 py-2 font-medium">Scoring</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {season.leagues.map((lg) => (
                <tr key={lg.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{lg.name}</td>
                  <td className="px-4 py-2">
                    {lg.scoring_validated
                      ? <Badge variant="secondary">✓ valid</Badge>
                      : <Badge variant="outline">⚠ unverified</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">{/* Task 4/5 add row actions */}</td>
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

- [ ] **Step 4: Wire the route**

In `frontend/src/routes.tsx`: import `SeasonDetailPage` and add `{ path: "seasons/:id", element: <SeasonDetailPage /> }` as a sibling of the `seasons` child inside `AdminLayout`'s children.

- [ ] **Step 5: Run the tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonDetailPage.test.tsx`
Expected: PASS (3 tests).
Then full: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/SeasonDetailPage.tsx frontend/src/pages/admin/SeasonDetailPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3b season detail page + edit modal + leagues table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add-league + Resync modal (async scoring-diff flow)

**Files:**
- Create: `frontend/src/pages/admin/LeagueSetupDialog.tsx`
- Test: `frontend/src/pages/admin/LeagueSetupDialog.test.tsx`
- Modify: `frontend/src/pages/admin/SeasonDetailPage.tsx` (wire Add league + per-row Resync, super-admin only)

**Interfaces:**
- Consumes: `useAddLeague`/`useResyncLeague` (Task 1), Dialog primitives, `Button`/`Input`/`Badge`, `isApiError`.
- Produces: `LeagueSetupDialog` — one component with two modes: `mode="add"` (Sleeper-ID input → `useAddLeague`) and `mode="resync"` (button → `useResyncLeague(leagueId)`); both render the shared `LeagueSetupResponse` result (scoring status + diffs table).

- [ ] **Step 1: Write the failing dialog test**

Create `frontend/src/pages/admin/LeagueSetupDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueSetupDialog } from "./LeagueSetupDialog";

function renderAdd() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeagueSetupDialog mode="add" seasonId={1} trigger={<button>Add league</button>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("adds a league and shows the validated result", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "abc123");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/added/i)).toBeInTheDocument();
  expect(screen.getByText(/New League/)).toBeInTheDocument();
});

test("shows the scoring diffs when scoring differs", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "diffs");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/scoring differs/i)).toBeInTheDocument();
  expect(screen.getByText("Pass TD")).toBeInTheDocument();
});

test("shows the 422 not-found error", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "notfound");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/sleeper league not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/pages/admin/LeagueSetupDialog.test.tsx`
Expected: FAIL — `./LeagueSetupDialog` does not exist.

- [ ] **Step 3: Create the dialog**

Create `frontend/src/pages/admin/LeagueSetupDialog.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { useAddLeague, useResyncLeague } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { LeagueSetupResponse } from "@/types/api";

type Props =
  | { mode: "add"; seasonId: number; trigger: ReactNode }
  | { mode: "resync"; seasonId: number; leagueId: number; trigger: ReactNode };

export function LeagueSetupDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [sleeperId, setSleeperId] = useState("");
  const [result, setResult] = useState<LeagueSetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = useAddLeague(props.seasonId);
  const resync = useResyncLeague(props.seasonId);
  const pending = add.isPending || resync.isPending;

  function reset() {
    setSleeperId(""); setResult(null); setError(null);
  }

  async function run() {
    setError(null);
    try {
      const res = props.mode === "add"
        ? await add.mutateAsync(sleeperId)
        : await resync.mutateAsync(props.leagueId);
      setResult(res);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Setup failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mode === "add" ? "Add league" : "Resync league"}</DialogTitle>
          <DialogDescription>
            Pulls rosters and validates scoring against the season ruleset.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{result.name}</span>
              <Badge variant="secondary">Added</Badge>
              {result.scoring_validated
                ? <Badge variant="secondary">✓ scoring valid</Badge>
                : <Badge variant="outline">⚠ scoring differs</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{result.teams.length} teams imported.</p>
            {result.diffs.length > 0 && (
              <table className="mt-1 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Category</th>
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 font-medium">Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {result.diffs.map((d) => (
                    <tr key={d.category} className="border-t">
                      <td className="py-1">{d.category}</td>
                      <td className="py-1 tabular-nums">{d.league_value}</td>
                      <td className="py-1 tabular-nums">{d.platform_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!result.scoring_validated && (
              <p className="text-xs text-muted-foreground">
                Added regardless — this flag is advisory. Fix the season ruleset then Resync, or leave as-is.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {props.mode === "add" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Sleeper league ID</span>
                <Input value={sleeperId} onChange={(e) => setSleeperId(e.target.value)} />
              </label>
            )}
            {props.mode === "resync" && (
              <p className="text-sm text-muted-foreground">Re-run setup sync for this league?</p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <DialogClose asChild><Button>Done</Button></DialogClose>
          ) : (
            <>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                onClick={run}
                disabled={pending || (props.mode === "add" && sleeperId.trim() === "")}
              >
                {pending ? "Working…" : props.mode === "add" ? "Add" : "Resync"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/pages/admin/LeagueSetupDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire Add-league + Resync into the season detail (super-admin)**

In `frontend/src/pages/admin/SeasonDetailPage.tsx`: import `LeagueSetupDialog` and `Button`. In the Leagues header, when `isSuper`, render the Add button; in each league row's actions cell, when `isSuper`, render Resync:

```tsx
// Leagues header:
{isSuper && (
  <LeagueSetupDialog mode="add" seasonId={season.id} trigger={<Button size="sm">+ Add league</Button>} />
)}
```

```tsx
// row actions cell:
<td className="px-4 py-2 text-right">
  {isSuper && (
    <LeagueSetupDialog
      mode="resync"
      seasonId={season.id}
      leagueId={lg.id}
      trigger={<Button variant="outline" size="sm">Resync</Button>}
    />
  )}
</td>
```

- [ ] **Step 6: Run the gate**

Run: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green (SeasonDetailPage tests still pass; the header/rows now include the super-admin dialogs).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/LeagueSetupDialog.tsx frontend/src/pages/admin/LeagueSetupDialog.test.tsx frontend/src/pages/admin/SeasonDetailPage.tsx
git commit -m "feat(frontend): FE-3b add-league + resync modal with scoring-diff review

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Sync-now + Delete league row actions + role-awareness

**Files:**
- Create: `frontend/src/pages/admin/LeagueRowActions.tsx`
- Modify: `frontend/src/pages/admin/SeasonDetailPage.tsx` (use `LeagueRowActions` for the actions cell)
- Test: `frontend/src/pages/admin/SeasonDetailPage.actions.test.tsx`

**Interfaces:**
- Consumes: `useSyncLeague`/`useDeleteLeague` (Task 1), `LeagueSetupDialog` (Task 4), Dialog primitives, `Button`, `isApiError`.
- Produces: `LeagueRowActions({ seasonId, leagueId, leagueName, canManage, canSync })` — renders Sync now (when `canSync`), Resync + Delete (when `canManage`), plus the inline sync result.

- [ ] **Step 1: Write the failing actions test**

Create `frontend/src/pages/admin/SeasonDetailPage.actions.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonDetailPage } from "./SeasonDetailPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(role = "super_admin") {
  localStorage.setItem("i2r_token", "tok.123");
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/seasons/1"]}>
        <AuthProvider>
          <Routes><Route path="/admin/seasons/:id" element={<SeasonDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("Sync now shows a result note (season is in playoffs)", async () => {
  renderAt("super_admin");
  const syncButtons = await screen.findAllByRole("button", { name: /sync now/i });
  await userEvent.click(syncButtons[0]);
  expect(await screen.findByText(/12 synced/i)).toBeInTheDocument();
});

test("league-admin sees Sync now but not Resync/Delete", async () => {
  renderAt("league_admin");
  expect((await screen.findAllByRole("button", { name: /sync now/i })).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /resync/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
});

test("Delete confirms then removes the league", async () => {
  renderAt("super_admin");
  const del = (await screen.findAllByRole("button", { name: /^delete$/i }))[0];
  await userEvent.click(del);
  await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
  // after 204 + invalidate, the confirm dialog closes
  expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
});
```

(The default `/api/seasons/:id` returns status "playoffs", so Sync now is enabled.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonDetailPage.actions.test.tsx`
Expected: FAIL — `./LeagueRowActions` does not exist / actions not wired.

- [ ] **Step 3: Create `LeagueRowActions`**

Create `frontend/src/pages/admin/LeagueRowActions.tsx`:

```tsx
import { useState } from "react";
import { useDeleteLeague, useSyncLeague } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { LeagueSetupDialog } from "./LeagueSetupDialog";
import type { SyncNowResponse } from "@/types/api";

export function LeagueRowActions({
  seasonId, leagueId, leagueName, canManage, canSync,
}: {
  seasonId: number; leagueId: number; leagueName: string; canManage: boolean; canSync: boolean;
}) {
  const sync = useSyncLeague();
  const del = useDeleteLeague(seasonId);
  const [syncResult, setSyncResult] = useState<SyncNowResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function onSync() {
    setSyncError(null); setSyncResult(null);
    try {
      setSyncResult(await sync.mutateAsync(leagueId));
    } catch (e) {
      setSyncError(isApiError(e) ? e.detail : "Sync failed");
    }
  }

  async function onDelete() {
    await del.mutateAsync(leagueId);
    setConfirmOpen(false);
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {syncResult && (
        <span className="text-xs text-muted-foreground">
          Week {syncResult.week} · {syncResult.teams_synced} synced · {syncResult.mismatches} mismatches
        </span>
      )}
      {syncError && <span className="text-xs text-destructive">{syncError}</span>}
      {canSync && (
        <Button variant="outline" size="sm" onClick={onSync} disabled={sync.isPending}>Sync now</Button>
      )}
      {canManage && (
        <LeagueSetupDialog
          mode="resync" seasonId={seasonId} leagueId={leagueId}
          trigger={<Button variant="outline" size="sm">Resync</Button>}
        />
      )}
      {canManage && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild><Button variant="destructive" size="sm">Delete</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {leagueName}?</DialogTitle>
              <DialogDescription>This removes the league and its data from the season.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Use `LeagueRowActions` in the season detail**

In `frontend/src/pages/admin/SeasonDetailPage.tsx`: remove the inline Resync added in Task 4 from the row cell and replace the actions `<td>` with `LeagueRowActions`; also compute `canSync`. Import `LeagueRowActions`. Sync is only valid for `regular`/`playoffs` seasons:

```tsx
const canSync = season.status === "regular" || season.status === "playoffs";
```

```tsx
<td className="px-4 py-2">
  <LeagueRowActions
    seasonId={season.id}
    leagueId={lg.id}
    leagueName={lg.name}
    canManage={isSuper}
    canSync={canSync}
  />
</td>
```

(Keep the Task 4 **Add league** button in the Leagues header as-is.)

- [ ] **Step 5: Run the tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/SeasonDetailPage.actions.test.tsx`
Expected: PASS (3 tests).
Then full: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/LeagueRowActions.tsx frontend/src/pages/admin/SeasonDetailPage.tsx frontend/src/pages/admin/SeasonDetailPage.actions.test.tsx
git commit -m "feat(frontend): FE-3b league row actions — sync-now + delete, role-aware

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`API_PROXY_TARGET=http://localhost:8123 npm --prefix frontend run dev` against the backend on `:8123`), log in as super-admin, and exercise: create a season, open it, Add league with a real Sleeper ID (watch the scoring-diff result), Sync now, Delete — all in light + dark. Confirm a league-admin login shows read + Sync now only.
- **PR:** open a PR from `plan/fe-3b-seasons-leagues` → `main` per [[git-workflow]]. No sensitive data.

## Self-review notes (author check)

- Spec coverage: mutations+types+Dialog+handlers (T1); shared adminSections + seasons list + create (T2); season detail + edit + leagues table (T3); add-league/resync scoring-diff modal (T4); sync-now + delete + role-awareness (T5). Non-goals (team mapping, brackets, grant filtering, ruleset selection, per-league page) excluded.
- Type consistency: `SeasonCreateBody`/`SeasonUpdateBody`/`LeagueSetupResponse`/`SyncNowResponse`, hooks (`useCreateSeason`/`useUpdateSeason`/`useAddLeague`/`useResyncLeague`/`useSyncLeague`/`useDeleteLeague`), `visibleSections`, and Dialog exports match across tasks. `useSeason` imported from `@/features/useSeasonDashboard`; `useSeasons` from `@/features/useSeasons`.
- No placeholders: every code step shows full code; run steps show command + expected result; commit steps stage only their own files.
- Roles: super-admin-only writes gated by `role === "super_admin"` in list/detail/actions; league-admin gets Sync now via `canSync`.
