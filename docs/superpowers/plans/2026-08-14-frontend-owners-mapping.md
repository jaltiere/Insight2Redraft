# FE-3c: Owners & Mapping + Public Owner Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin owner CRUD (list/search/create/view/edit), a team→owner mapping worksheet with inline owner-create, and the public owner profile page that resolves the currently-404ing owner links.

**Architecture:** New admin owner + mapping mutation/query hooks over the existing api-client (`get/post/patch`); a public owner-profile query hook; a custom lightweight `OwnerPicker` combobox; forms reuse the FE-3b radix `Dialog`. Reads for the public profile reuse the FE-1b page patterns and `standings.ts` helpers.

**Tech Stack:** React 19, TS6, React Router v7, TanStack Query, Tailwind v4 (semantic tokens), radix-ui, Vitest+RTL+MSW.

Spec: `docs/superpowers/specs/2026-08-14-frontend-owners-mapping-design.md`
Branch: `plan/fe-3c-owners-mapping` (already created off `main`).

## Global Constraints

- All frontend commands run against `frontend/` (`npm --prefix frontend <...>`). Gate per task: build + test + lint all green.
- **Semantic tokens only** (light+dark): `bg-card`, `border`, `text-primary`, `text-muted-foreground`, `text-destructive`, `text-highlight`, `text-foreground`, `bg-muted`; the `Button`/`Input`/`Badge`/`Dialog` primitives.
- **No new dependencies.** The combobox is custom (`<input>` + a positioned list).
- TypeScript 6: `import type`; `@/` alias only.
- **Roles (mirror backend):** create/list/view owners = any admin; **edit owner = super-admin only** (gate the Edit trigger on `role === "super_admin"`); mapping = league-admin+ (any admin in the UI). Public profile = unauthenticated.
- **Every Dialog includes `DialogTitle` + `DialogDescription`** (radix a11y → pristine test output). **Dialogs reset their form state on OPEN** (learned in FE-3b: reset-on-open prevents stale state across reopens).
- Tests: MSW `onUnhandledRequest: "error"` — Task 1 adds the owner/mapping/profile handlers. Default `/api/auth/me` → super_admin; league_admin via `server.use`. Route/param pages wrapped in `MemoryRouter`(+`Routes`/`Route`). `import type` for React types.
- **Commit hygiene:** the working tree has unrelated `.claude/*` vexp noise + `.superpowers/` scratch. Every commit stages ONLY its named files — never `git add -A`.
- No backend changes.

---

### Task 1: Foundation — owner/mapping/profile types, hooks, MSW handlers

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/features/adminOwners.ts`
- Create: `frontend/src/features/useOwnerProfile.ts`
- Test: `frontend/src/features/adminOwners.test.tsx`
- Modify: `frontend/src/test/handlers.ts`

**Interfaces:**
- Produces types: `OwnerAdminResponse`, `OwnerSleeperLinkRef`, `OwnerAdminDetail`, `OwnerCreateBody`, `OwnerUpdateBody`, `TeamMappingRow`, `OwnerSeasonRecord`, `BestWeeklyEntry`, `OwnerProfile`.
- Produces hooks: `useOwners(q: string, enabled?: boolean)` → `["owners", q]`; `useOwner(id)` → `["owner", id]` (`OwnerAdminDetail`); `useCreateOwner()`; `useUpdateOwner(id)`; `useTeamMappings(leagueId)` → `["mappings", leagueId]`; `useAssignTeamOwner(leagueId)` (`{ teamId, ownerId }`); `useOwnerProfile(id)` → `["ownerProfile", id]`.

- [ ] **Step 1: Add the types**

Append to `frontend/src/types/api.ts`:

```ts
export interface OwnerAdminResponse {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  notes: string | null;
}

export interface OwnerSleeperLinkRef {
  sleeper_user_id: string;
  season: number;
  sleeper_display_name: string | null;
}

export interface OwnerAdminDetail extends OwnerAdminResponse {
  sleeper_links: OwnerSleeperLinkRef[];
}

export interface OwnerCreateBody {
  first_name: string;
  last_name: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  notes?: string | null;
}

export type OwnerUpdateBody = Partial<OwnerCreateBody>;

export interface TeamMappingRow {
  team_id: number;
  sleeper_roster_id: number;
  sleeper_user_id: string | null;
  sleeper_display_name: string | null;
  owner: OwnerRef | null;
}

export interface OwnerSeasonRecord {
  season_year: number;
  league_id: number;
  league_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
}

export interface BestWeeklyEntry {
  season_year: number;
  league_name: string;
  week: number;
  points: number;
}

export interface OwnerProfile {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
  season_records: OwnerSeasonRecord[];
  best_weekly: BestWeeklyEntry[];
}
```

- [ ] **Step 2: Create the admin hooks**

Create `frontend/src/features/adminOwners.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  OwnerAdminDetail, OwnerAdminResponse, OwnerCreateBody, OwnerUpdateBody, TeamMappingRow,
} from "@/types/api";

export function useOwners(q: string, enabled = true) {
  return useQuery({
    queryKey: ["owners", q],
    queryFn: () => apiClient.get<OwnerAdminResponse[]>(`/admin/owners?q=${encodeURIComponent(q)}`),
    enabled,
  });
}

export function useOwner(id: number | null) {
  return useQuery({
    queryKey: ["owner", id],
    queryFn: () => apiClient.get<OwnerAdminDetail>(`/admin/owners/${id}`),
    enabled: id !== null,
  });
}

export function useCreateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OwnerCreateBody) => apiClient.post<OwnerAdminResponse>("/admin/owners", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owners"] }),
  });
}

export function useUpdateOwner(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OwnerUpdateBody) => apiClient.patch<OwnerAdminResponse>(`/admin/owners/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", id] });
      qc.invalidateQueries({ queryKey: ["owners"] });
    },
  });
}

export function useTeamMappings(leagueId: number) {
  return useQuery({
    queryKey: ["mappings", leagueId],
    queryFn: () => apiClient.get<TeamMappingRow[]>(`/admin/leagues/${leagueId}/teams`),
  });
}

export function useAssignTeamOwner(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, ownerId }: { teamId: number; ownerId: number }) =>
      apiClient.patch<TeamMappingRow>(`/admin/leagues/${leagueId}/teams/${teamId}`, { owner_id: ownerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mappings", leagueId] }),
  });
}
```

- [ ] **Step 3: Create the public profile hook**

Create `frontend/src/features/useOwnerProfile.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { OwnerProfile } from "@/types/api";

export function useOwnerProfile(id: number | null) {
  return useQuery({
    queryKey: ["ownerProfile", id],
    queryFn: () => apiClient.get<OwnerProfile>(`/owners/${id}`),
    enabled: id !== null,
  });
}
```

- [ ] **Step 4: Write the failing foundation test**

Create `frontend/src/features/adminOwners.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useOwners } from "./adminOwners";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

test("useOwners passes the search query and returns matches", async () => {
  const { result } = renderHook(() => useOwners("mar"), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.some((o) => o.first_name === "Maria")).toBe(true);
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/features/adminOwners.test.tsx`
Expected: FAIL — no MSW handler for `/api/admin/owners` (unhandled request → error), and/or `useOwners` unresolved.

- [ ] **Step 6: Add MSW handlers**

In `frontend/src/test/handlers.ts`, add to the `handlers` array:

```ts
  // --- admin: owners (FE-3c) ---
  http.get("/api/admin/owners", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const all = [
      { id: 1, first_name: "Jack", last_name: "Altiere", email: "jack@ex.com", display_name: "JackA", avatar_url: null, notes: "commish" },
      { id: 2, first_name: "Maria", last_name: "Pappas", email: "maria@ex.com", display_name: null, avatar_url: null, notes: null },
    ];
    const rows = q ? all.filter((o) => `${o.first_name} ${o.last_name} ${o.email ?? ""}`.toLowerCase().includes(q)) : all;
    return HttpResponse.json(rows);
  }),
  http.post("/api/admin/owners", async ({ request }) => {
    const b = (await request.json()) as { email?: string | null };
    if (b.email === "dupe@ex.com") return HttpResponse.json({ detail: "Owner email already exists" }, { status: 409 });
    return HttpResponse.json({ id: 99, first_name: "New", last_name: "Owner", email: b.email ?? null, display_name: null, avatar_url: null, notes: null }, { status: 201 });
  }),
  http.get("/api/admin/owners/:id", ({ params }) =>
    HttpResponse.json({
      id: Number(params.id), first_name: "Jack", last_name: "Altiere", email: "jack@ex.com",
      display_name: "JackA", avatar_url: null, notes: "commish",
      sleeper_links: [{ sleeper_user_id: "u1", season: 2024, sleeper_display_name: "jaltiere" }],
    }),
  ),
  http.patch("/api/admin/owners/:id", async ({ params, request }) => {
    const b = (await request.json()) as Record<string, unknown>;
    if (b.email === "dupe@ex.com") return HttpResponse.json({ detail: "Owner email already exists" }, { status: 409 });
    return HttpResponse.json({ id: Number(params.id), first_name: "Jack", last_name: "Altiere", email: "jack@ex.com", display_name: "JackA", avatar_url: null, notes: null, ...b });
  }),
  // --- admin: team mapping (FE-3c) ---
  http.get("/api/admin/leagues/:id/teams", () =>
    HttpResponse.json([
      { team_id: 31, sleeper_roster_id: 3, sleeper_user_id: "u1", sleeper_display_name: "jaltiere", owner: { id: 1, first_name: "Jack", last_name: "Altiere", display_name: "JackA" } },
      { team_id: 32, sleeper_roster_id: 5, sleeper_user_id: "u2", sleeper_display_name: "mpappas", owner: null },
    ]),
  ),
  http.patch("/api/admin/leagues/:lid/teams/:tid", async ({ params, request }) => {
    const b = (await request.json()) as { owner_id: number };
    if (b.owner_id === 0) return HttpResponse.json({ detail: "Owner does not exist" }, { status: 422 });
    return HttpResponse.json({ team_id: Number(params.tid), sleeper_roster_id: 5, sleeper_user_id: "u2", sleeper_display_name: "mpappas", owner: { id: b.owner_id, first_name: "Maria", last_name: "Pappas", display_name: null } });
  }),
  // --- public: owner profile (FE-3c) ---
  http.get("/api/owners/:id", ({ params }) => {
    if (params.id === "404") return HttpResponse.json({ detail: "Owner not found" }, { status: 404 });
    return HttpResponse.json({
      id: Number(params.id), first_name: "Jack", last_name: "Altiere", display_name: "JackA", avatar_url: null,
      season_records: [{ season_year: 2024, league_id: 3, league_name: "Dynasty League", wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: 1 }],
      best_weekly: [{ season_year: 2024, league_name: "Dynasty League", week: 5, points: 155.2 }],
    });
  }),
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/features/adminOwners.test.tsx`
Expected: PASS.

- [ ] **Step 8: Full gate + commit**

Run: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — green.

```bash
git add frontend/src/types/api.ts frontend/src/features/adminOwners.ts frontend/src/features/useOwnerProfile.ts frontend/src/features/adminOwners.test.tsx frontend/src/test/handlers.ts
git commit -m "feat(frontend): FE-3c foundation — owner/mapping/profile types, hooks, MSW handlers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: OwnerFormDialog + Owners list page + route

**Files:**
- Create: `frontend/src/pages/admin/OwnerFormDialog.tsx`
- Create: `frontend/src/pages/admin/OwnersListPage.tsx`
- Test: `frontend/src/pages/admin/OwnersListPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useOwners`, `useCreateOwner`, `useUpdateOwner` (Task 1), Dialog primitives, `Button`/`Input`, `ownerName`.
- Produces: `OwnerFormDialog` — props `{ trigger; mode: "create" | "edit"; owner?: OwnerAdminResponse; prefillFirstName?: string; onCreated?: (o: OwnerAdminResponse) => void }`; `OwnersListPage`; route `/admin/owners`.

- [ ] **Step 1: Write the failing list test**

Create `frontend/src/pages/admin/OwnersListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { OwnersListPage } from "./OwnersListPage";
import { AuthProvider } from "@/auth/AuthProvider";

afterEach(() => localStorage.clear());

function renderPage() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AuthProvider><OwnersListPage /></AuthProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

test("lists owners and links to detail", async () => {
  renderPage();
  expect(await screen.findByRole("link", { name: /Jack Altiere|JackA/ })).toHaveAttribute("href", "/admin/owners/1");
});

test("New owner create shows the 409 inline", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /new owner/i }));
  await userEvent.type(screen.getByLabelText(/first name/i), "Dupe");
  await userEvent.type(screen.getByLabelText(/last name/i), "Person");
  await userEvent.type(screen.getByLabelText(/email/i), "dupe@ex.com");
  await userEvent.click(screen.getByRole("button", { name: /create/i }));
  expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL** (`./OwnersListPage` missing).

Run: `npm --prefix frontend test -- src/pages/admin/OwnersListPage.test.tsx`

- [ ] **Step 3: Create `OwnerFormDialog`**

Create `frontend/src/pages/admin/OwnerFormDialog.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateOwner, useUpdateOwner } from "@/features/adminOwners";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { OwnerAdminResponse } from "@/types/api";

type Props = {
  trigger: ReactNode;
  mode: "create" | "edit";
  owner?: OwnerAdminResponse;
  prefillFirstName?: string;
  onCreated?: (o: OwnerAdminResponse) => void;
};

export function OwnerFormDialog({ trigger, mode, owner, prefillFirstName, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateOwner();
  const update = useUpdateOwner(owner?.id ?? 0);
  const pending = create.isPending || update.isPending;

  function reset() {
    setFirst(owner?.first_name ?? prefillFirstName ?? "");
    setLast(owner?.last_name ?? "");
    setEmail(owner?.email ?? "");
    setDisplay(owner?.display_name ?? "");
    setNotes(owner?.notes ?? "");
    setError(null);
  }

  async function onSubmit() {
    setError(null);
    const body = {
      first_name: first, last_name: last,
      email: email || null, display_name: display || null, notes: notes || null,
    };
    try {
      if (mode === "edit") {
        await update.mutateAsync(body);
      } else {
        const created = await create.mutateAsync(body);
        onCreated?.(created);
      }
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Save failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit owner" : "New owner"}</DialogTitle>
          <DialogDescription>Owner identity used across leagues and seasons.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">First name</span>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Last name</span>
            <Input value={last} onChange={(e) => setLast(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Email</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Display name</span>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={pending || first.trim() === "" || last.trim() === ""}>
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create `OwnersListPage`**

Create `frontend/src/pages/admin/OwnersListPage.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useOwners } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";

export function OwnersListPage() {
  const [q, setQ] = useState("");
  const owners = useOwners(q);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Owners</h1>
        <OwnerFormDialog mode="create" trigger={<Button>New owner</Button>} />
      </div>
      <Input className="mb-4 max-w-sm" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      {owners.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : owners.isError ? (
        <p className="text-destructive">Couldn't load owners.</p>
      ) : owners.data.length === 0 ? (
        <p className="text-muted-foreground">No owners match.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {owners.data.map((o) => (
            <li key={o.id}>
              <Link to={`/admin/owners/${o.id}`} className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary">
                <span className="font-medium">{ownerName(o)}</span>
                <span className="text-sm text-muted-foreground">{o.email ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

(Note: `ownerName` accepts anything with `first_name`/`last_name`/`display_name`; `OwnerAdminResponse` satisfies it.)

- [ ] **Step 5: Wire the route** — in `frontend/src/routes.tsx`, import `OwnersListPage` and replace `{ path: "owners", element: <AdminSectionStub title="Owners" /> }` with `{ path: "owners", element: <OwnersListPage /> }`.

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/OwnersListPage.test.tsx`, then full `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/OwnerFormDialog.tsx frontend/src/pages/admin/OwnersListPage.tsx frontend/src/pages/admin/OwnersListPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3c owners list + create/edit owner dialog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Owner detail page + edit + route

**Files:**
- Create: `frontend/src/pages/admin/OwnerDetailPage.tsx`
- Test: `frontend/src/pages/admin/OwnerDetailPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useOwner` (Task 1), `useAuth`, `OwnerFormDialog` (Task 2), `ownerName`, `Button`/`Badge`, `NotFound`, `isApiError`.
- Produces: `OwnerDetailPage`; route `/admin/owners/:id`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/OwnerDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { OwnerDetailPage } from "./OwnerDetailPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(role = "super_admin") {
  localStorage.setItem("i2r_token", "tok.123");
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/owners/1"]}>
        <AuthProvider><Routes><Route path="/admin/owners/:id" element={<OwnerDetailPage />} /></Routes></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders owner header + sleeper links", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /Jack Altiere|JackA/ })).toBeInTheDocument();
  expect(screen.getByText(/jaltiere/)).toBeInTheDocument();
});

test("Edit is super-admin only", async () => {
  renderAt("league_admin");
  await screen.findByRole("heading", { name: /Jack Altiere|JackA/ });
  expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npm --prefix frontend test -- src/pages/admin/OwnerDetailPage.test.tsx`

- [ ] **Step 3: Create the page**

Create `frontend/src/pages/admin/OwnerDetailPage.tsx`:

```tsx
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useOwner } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFound } from "@/pages/NotFound";
import { OwnerFormDialog } from "./OwnerFormDialog";
import { isApiError } from "@/lib/api-client";

export function OwnerDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const { role } = useAuth();
  const q = useOwner(valid ? id : null);

  if (!valid) return <NotFound title="Owner not found" message="We couldn't find that owner." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Owner not found" message="We couldn't find that owner." />;
    }
    return <p className="text-destructive">Couldn't load this owner.</p>;
  }

  const owner = q.data;

  return (
    <div>
      <div className="mb-1"><Link to="/admin/owners" className="text-sm text-primary hover:underline">← Owners</Link></div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{ownerName(owner)}</h1>
        {owner.email && <span className="text-sm text-muted-foreground">{owner.email}</span>}
        {role === "super_admin" && (
          <span className="ml-auto">
            <OwnerFormDialog mode="edit" owner={owner} trigger={<Button variant="outline">Edit</Button>} />
          </span>
        )}
      </div>
      {owner.notes && <p className="mb-4 border-l-2 border-border pl-3 text-sm text-muted-foreground">{owner.notes}</p>}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sleeper links</h2>
      {owner.sleeper_links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Sleeper links yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owner.sleeper_links.map((l) => (
            <li key={`${l.season}-${l.sleeper_user_id}`} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{l.season}</span>
              <span className="font-medium">{l.sleeper_display_name ?? l.sleeper_user_id}</span>
              <Badge variant="outline" className="ml-auto">{l.sleeper_user_id}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the route** — in `frontend/src/routes.tsx`, import `OwnerDetailPage` and add `{ path: "owners/:id", element: <OwnerDetailPage /> }` as a sibling of the `owners` child.

- [ ] **Step 5: Run tests + gate**, then **commit**:

```bash
git add frontend/src/pages/admin/OwnerDetailPage.tsx frontend/src/pages/admin/OwnerDetailPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3c owner detail page + super-admin edit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: OwnerPicker combobox

**Files:**
- Create: `frontend/src/lib/useDebounced.ts`
- Create: `frontend/src/pages/admin/OwnerPicker.tsx`
- Test: `frontend/src/pages/admin/OwnerPicker.test.tsx`

**Interfaces:**
- Consumes: `useOwners`/`useAssignTeamOwner` (Task 1), `OwnerFormDialog` (Task 2), `ownerName`, `Button`/`Input`, `isApiError`.
- Produces: `useDebounced<T>(value, ms)`; `OwnerPicker({ leagueId, teamId, sleeperName, current })`.

- [ ] **Step 1: Create the debounce hook**

Create `frontend/src/lib/useDebounced.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
```

- [ ] **Step 2: Write the failing picker test**

Create `frontend/src/pages/admin/OwnerPicker.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { OwnerPicker } from "./OwnerPicker";

function renderPicker(current: null | { id: number; first_name: string; last_name: string; display_name: string | null } = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OwnerPicker leagueId={9} teamId={32} sleeperName="mpappas" current={current} />
    </QueryClientProvider>,
  );
}

test("unassigned shows a warning and an assign affordance", () => {
  renderPicker(null);
  expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /assign/i })).toBeInTheDocument();
});

test("searching and selecting an owner assigns it", async () => {
  renderPicker(null);
  await userEvent.click(screen.getByRole("button", { name: /assign/i }));
  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  const option = await screen.findByRole("button", { name: /Maria Pappas/ });
  await userEvent.click(option);
  // after assign resolves, the picker collapses back to the resting state
  expect(await screen.findByText(/Maria Pappas|Pappas/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it — expect FAIL.**

Run: `npm --prefix frontend test -- src/pages/admin/OwnerPicker.test.tsx`

- [ ] **Step 4: Create the picker**

Create `frontend/src/pages/admin/OwnerPicker.tsx`:

```tsx
import { useState } from "react";
import { useAssignTeamOwner, useOwners } from "@/features/adminOwners";
import { useDebounced } from "@/lib/useDebounced";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";
import type { OwnerRef } from "@/types/api";

export function OwnerPicker({
  leagueId, teamId, sleeperName, current,
}: {
  leagueId: number; teamId: number; sleeperName: string | null; current: OwnerRef | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [assigned, setAssigned] = useState<OwnerRef | null>(current);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(text, 250);
  const results = useOwners(q, open);
  const assign = useAssignTeamOwner(leagueId);

  async function pick(ownerId: number) {
    setError(null);
    try {
      const row = await assign.mutateAsync({ teamId, ownerId });
      setAssigned(row.owner);
      setOpen(false); setText("");
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Assign failed");
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {assigned ? (
          <span className="font-medium text-foreground">{ownerName(assigned)}</span>
        ) : (
          <span className="text-highlight">⚠ Unassigned</span>
        )}
        <Button variant="link" size="sm" onClick={() => setOpen(true)}>{assigned ? "change" : "assign"}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input autoFocus value={text} placeholder="Search owners…" onChange={(e) => setText(e.target.value)} />
      <div className="rounded-md border bg-card">
        {results.data?.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => pick(o.id)}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {ownerName(o)}{o.email ? <span className="text-muted-foreground"> · {o.email}</span> : null}
          </button>
        ))}
        <OwnerFormDialog
          mode="create"
          prefillFirstName={sleeperName ?? ""}
          onCreated={(o) => pick(o.id)}
          trigger={
            <button type="button" className="block w-full px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted">
              ＋ Create {sleeperName ? `"${sleeperName}"` : "new owner"}
            </button>
          }
        />
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**, then full gate.

Run: `npm --prefix frontend test -- src/pages/admin/OwnerPicker.test.tsx`, then `npm --prefix frontend test`, build, lint — green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useDebounced.ts frontend/src/pages/admin/OwnerPicker.tsx frontend/src/pages/admin/OwnerPicker.test.tsx
git commit -m "feat(frontend): FE-3c OwnerPicker combobox — search + inline-create + assign

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Mapping page + route + season-detail "Map owners" link

**Files:**
- Create: `frontend/src/pages/admin/MappingPage.tsx`
- Test: `frontend/src/pages/admin/MappingPage.test.tsx`
- Modify: `frontend/src/routes.tsx`
- Modify: `frontend/src/pages/admin/LeagueRowActions.tsx` (add Map owners link)

**Interfaces:**
- Consumes: `useTeamMappings` (Task 1), `OwnerPicker` (Task 4), `useSeason`? no — mapping is league-scoped; a plain back link to the browser is enough. `NotFound`, `isApiError`, `Link`.
- Produces: `MappingPage`; route `/admin/leagues/:id/mapping`; a Map-owners link in `LeagueRowActions`.

- [ ] **Step 1: Write the failing mapping test**

Create `frontend/src/pages/admin/MappingPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { MappingPage } from "./MappingPage";
import { AuthProvider } from "@/auth/AuthProvider";

afterEach(() => localStorage.clear());

function renderAt() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/leagues/9/mapping"]}>
        <AuthProvider>
          <Routes><Route path="/admin/leagues/:id/mapping" element={<MappingPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders team rows with assigned + unassigned owners", async () => {
  renderAt();
  expect(await screen.findByText("jaltiere")).toBeInTheDocument();
  expect(screen.getByText(/Jack Altiere|JackA/)).toBeInTheDocument(); // assigned row
  expect(screen.getByText(/unassigned/i)).toBeInTheDocument();         // roster 5 row
});

test("assigning the unassigned team via the picker updates the row", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /assign/i }));
  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  await userEvent.click(await screen.findByRole("button", { name: /Maria Pappas/ }));
  expect(await screen.findByText(/Pappas/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npm --prefix frontend test -- src/pages/admin/MappingPage.test.tsx`

- [ ] **Step 3: Create the mapping page**

Create `frontend/src/pages/admin/MappingPage.tsx`:

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { useTeamMappings } from "@/features/adminOwners";
import { OwnerPicker } from "./OwnerPicker";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api-client";

export function MappingPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const navigate = useNavigate();
  const q = useTeamMappings(valid ? id : 0);

  if (!valid) return <NotFound title="League not found" message="We couldn't find that league." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="League not found" message="We couldn't find that league." />;
    }
    return <p className="text-destructive">Couldn't load the mapping.</p>;
  }

  const rows = q.data;
  const unassigned = rows.filter((r) => r.owner === null).length;

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Map owners</h1>
      <p className="mb-4 text-sm text-muted-foreground">{rows.length} teams · {unassigned} unassigned. Changes save per row.</p>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Roster</th>
              <th className="px-4 py-2 font-medium">Sleeper user</th>
              <th className="px-4 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team_id} className="border-t align-top">
                <td className="px-4 py-2 tabular-nums">#{r.sleeper_roster_id}</td>
                <td className="px-4 py-2 font-medium">{r.sleeper_display_name ?? r.sleeper_user_id ?? "—"}</td>
                <td className="px-4 py-2">
                  <OwnerPicker leagueId={id} teamId={r.team_id} sleeperName={r.sleeper_display_name} current={r.owner} />
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

- [ ] **Step 4: Wire the route** — in `frontend/src/routes.tsx`, import `MappingPage` and add `{ path: "leagues/:id/mapping", element: <MappingPage /> }` inside `AdminLayout`'s children (sibling of the `seasons` routes).

- [ ] **Step 5: Add the Map-owners link to `LeagueRowActions`**

In `frontend/src/pages/admin/LeagueRowActions.tsx`: import `Link` from `react-router-dom`, and add a Map-owners link (shown to any admin — mapping is league-admin+) as the first action in the row's `<div>`:

```tsx
import { Link } from "react-router-dom";
```

```tsx
      <Button asChild variant="outline" size="sm">
        <Link to={`/admin/leagues/${leagueId}/mapping`}>Map owners</Link>
      </Button>
```

Place it before the `{canSync && ...}` block. (No role prop needed — the component only renders inside the admin area.)

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/MappingPage.test.tsx src/pages/admin/SeasonDetailPage.actions.test.tsx`, then full `npm --prefix frontend test`, build, lint — green. (The season-detail actions test should still pass; the new Map-owners link doesn't break its Sync/Delete assertions.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/MappingPage.tsx frontend/src/pages/admin/MappingPage.test.tsx frontend/src/routes.tsx frontend/src/pages/admin/LeagueRowActions.tsx
git commit -m "feat(frontend): FE-3c mapping worksheet + Map-owners link on season detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Public owner profile page + route

**Files:**
- Create: `frontend/src/pages/OwnerProfilePage.tsx`
- Test: `frontend/src/pages/OwnerProfilePage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useOwnerProfile` (Task 1), `ownerName`/`teamRecord`/`ordinal` (`@/features/standings`), `NotFound`, `isApiError`.
- Produces: `OwnerProfilePage`; public route `/owners/:id` (in `PublicLayout`, before the `*` catch-all).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/OwnerProfilePage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { OwnerProfilePage } from "./OwnerProfilePage";

function renderAt(path = "/owners/1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/owners/:id" element={<OwnerProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders season records and best-weekly", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /Jack Altiere|JackA/ })).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByText(/155\.2/)).toBeInTheDocument();
});

test("shows not-found on a 404", async () => {
  renderAt("/owners/404");
  expect(await screen.findByText(/owner not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npm --prefix frontend test -- src/pages/OwnerProfilePage.test.tsx`

- [ ] **Step 3: Create the page**

Create `frontend/src/pages/OwnerProfilePage.tsx`:

```tsx
import { useParams } from "react-router-dom";
import { useOwnerProfile } from "@/features/useOwnerProfile";
import { ownerName, ordinal, teamRecord } from "@/features/standings";
import { NotFound } from "@/pages/NotFound";
import { isApiError } from "@/lib/api-client";

export function OwnerProfilePage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const q = useOwnerProfile(valid ? id : null);

  if (!valid) return <NotFound title="Owner not found" message="We couldn't find that owner." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Owner not found" message="We couldn't find that owner." />;
    }
    return <p className="text-destructive">Couldn't load this owner.</p>;
  }

  const owner = q.data;

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        {owner.avatar_url ? (
          <img src={owner.avatar_url} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {ownerName(owner).slice(0, 1)}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{ownerName(owner)}</h1>
      </div>

      <h2 className="mb-2 text-lg font-semibold">Season records</h2>
      {owner.season_records.length === 0 ? (
        <p className="text-muted-foreground">No season records yet.</p>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium">League</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Points for</th>
                <th className="px-4 py-2 font-medium">Finish</th>
              </tr>
            </thead>
            <tbody>
              {owner.season_records.map((r) => (
                <tr key={`${r.season_year}-${r.league_id}`} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{r.season_year}</td>
                  <td className="px-4 py-2">{r.league_name}</td>
                  <td className="px-4 py-2 tabular-nums">{teamRecord(r)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.points_for.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 tabular-nums">{r.league_finish != null ? ordinal(r.league_finish) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold">Best weekly scores</h2>
      {owner.best_weekly.length === 0 ? (
        <p className="text-muted-foreground">No weekly scores yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owner.best_weekly.map((b, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="font-semibold tabular-nums text-primary">{b.points.toLocaleString("en-US")}</span>
              <span className="text-muted-foreground">{b.season_year} · {b.league_name} · week {b.week}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the public route** — in `frontend/src/routes.tsx`, import `OwnerProfilePage` and add `{ path: "owners/:id", element: <OwnerProfilePage /> }` to `PublicLayout`'s children, **before** the `{ path: "*", element: <NotFound /> }` catch-all.

- [ ] **Step 5: Run tests + gate**, then **commit**:

```bash
git add frontend/src/pages/OwnerProfilePage.tsx frontend/src/pages/OwnerProfilePage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3c public owner profile page at /owners/:id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`API_PROXY_TARGET=http://localhost:8123 npm --prefix frontend run dev`) against a seeded backend with a synced league: create/search/edit owners, open the mapping worksheet and assign owners (incl. inline-create), and open a public `/owners/:id` from a standings/team owner link — all in light + dark.
- **PR:** open a PR from `plan/fe-3c-owners-mapping` → `main` per [[git-workflow]]. No sensitive data.

## Self-review notes (author check)

- Spec coverage: types+hooks+handlers (T1); owners list + create/edit dialog (T2); owner detail + super-admin edit (T3); OwnerPicker search+inline-create+assign (T4); mapping worksheet + Map-owners link (T5); public owner profile resolving the 404 links (T6). Non-goals (accounts, brackets, teams-owned, grant-filtering) excluded.
- Type consistency: `useOwners/useOwner/useCreateOwner/useUpdateOwner/useTeamMappings/useAssignTeamOwner/useOwnerProfile`, `OwnerFormDialog` props (`mode/owner/prefillFirstName/onCreated`), `OwnerPicker` props, and route paths match across tasks. `ownerName` accepts `OwnerAdminResponse`/`OwnerProfile`/`OwnerRef` (all carry first/last/display).
- Dialogs reset on open (FE-3b lesson) and carry Title+Description. No placeholders; commit steps stage only their own files.
