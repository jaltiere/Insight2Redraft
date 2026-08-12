# FE-3a: Admin Shell + Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the admin-area foundation — a distinct role-aware sidebar-console shell, a hardened 401→logout session flow, and a section-hub landing — with real admin CRUD deferred to FE-3b+ (sections are "coming soon" stubs).

**Architecture:** `token.ts` becomes the single source of truth and notifies subscribers on change; `AuthProvider` subscribes and clears account + React Query cache when the token goes null (the api-client already clears the token on 401), so `ProtectedRoute` redirects. The admin shell is a dark-rail sidebar console (an always-dark `--admin-rail` token added for the rail), with role-aware nav and a hub landing.

**Tech Stack:** React 19, TypeScript 6, React Router v7 (`react-router-dom`), TanStack Query, Tailwind v4 (semantic tokens), Vitest + RTL + MSW.

Spec: `docs/superpowers/specs/2026-08-12-frontend-admin-shell-design.md`
Branch: `plan/fe-3a-admin-shell` (already created off `main`).

## Global Constraints

- All frontend commands run against `frontend/` (`npm --prefix frontend <...>`). Gate per task: `npm --prefix frontend run build` + `npm --prefix frontend test` + `npm --prefix frontend run lint` all green.
- **Semantic tokens only** — no hardcoded colors; must resolve in light AND dark. Task 2 adds an **always-dark** `--admin-rail` / `--admin-rail-foreground` token pair (deliberately identical in `:root` and `.dark` so the admin rail is dark in both themes) → utilities `bg-admin-rail` / `text-admin-rail-foreground`. Existing tokens used: `bg-primary`, `text-primary-foreground`, `text-highlight`, `bg-card`, `border`, `text-muted-foreground`, `text-destructive`.
- **No new dependencies.**
- TypeScript 6: `import type { ... }` for type-only imports; `@/` alias only.
- Tests: MSW runs `onUnhandledRequest: "error"`. Existing handlers (`src/test/handlers.ts`) provide `POST /api/auth/login` (`admin@example.com`/`pw` → `tok.123`) and `GET /api/auth/me` (Bearer `tok.123` → `super_admin`, `owner_id: null`). To test a **league_admin**, override in-test with `server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 })))`. Route/param components are wrapped in `MemoryRouter` (+ `Routes`/`Route`) in tests. Use `import type` for React types.
- **Commit hygiene:** the working tree has unrelated pending changes (`vite.config.ts`, `docs/local-dev.md`, `.claude/*` vexp noise). **Stage only the files named in each task's commit step** — never `git add -A`/`git commit -am`.
- No backend changes.

---

### Task 1: Auth session hardening (401 → logout, return-to)

Make the token the source of truth; clear auth state on token-null; preserve and restore the requested route through login.

**Files:**
- Modify: `frontend/src/auth/token.ts`
- Modify: `frontend/src/auth/AuthProvider.tsx`
- Modify: `frontend/src/auth/ProtectedRoute.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/auth/auth.test.tsx` (extend)

**Interfaces:**
- Consumes: `queryClient` (`@/lib/queryClient`), `apiClient`/`isApiError`, existing `useAuth`.
- Produces:
  - `subscribeToken(listener: (token: string | null) => void): () => void` (in `token.ts`); `setToken`/`clearToken` now notify.
  - `ProtectedRoute` redirects with router state `{ from: location }`.
  - `LoginPage` navigates to `location.state.from.pathname ?? "/admin"` after login.

- [ ] **Step 1: Write the failing token-subscription test**

Add to `frontend/src/auth/auth.test.tsx` (new imports: `act` from `@testing-library/react`; `subscribeToken, setToken, clearToken` from `./token`):

```tsx
test("subscribeToken notifies on set/clear and stops after unsubscribe", () => {
  const seen: (string | null)[] = [];
  const unsub = subscribeToken((t) => seen.push(t));
  setToken("abc");
  clearToken();
  unsub();
  setToken("def");
  expect(seen).toEqual(["abc", null]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/auth/auth.test.tsx -t "subscribeToken"`
Expected: FAIL — `subscribeToken` is not exported.

- [ ] **Step 3: Add the subscription to `token.ts`**

Replace `frontend/src/auth/token.ts` with:

```ts
const KEY = "i2r_token";

type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

export const getToken = () => localStorage.getItem(KEY);

export function setToken(t: string) {
  localStorage.setItem(KEY, t);
  notify();
}

export function clearToken() {
  localStorage.removeItem(KEY);
  notify();
}

export function subscribeToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  const token = getToken();
  for (const listener of listeners) listener(token);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/auth/auth.test.tsx -t "subscribeToken"`
Expected: PASS.

- [ ] **Step 5: Wire the subscriber into `AuthProvider`**

In `frontend/src/auth/AuthProvider.tsx`: import `queryClient` and `subscribeToken`, and add a second effect (after the hydrate effect). Update the imports line and add the effect:

```tsx
import { clearToken, getToken, setToken, subscribeToken } from "@/auth/token";
import { queryClient } from "@/lib/queryClient";
```

```tsx
  // A mid-session 401 (or explicit logout) clears the token via the api-client;
  // when the token goes null, drop the cached account + queries so ProtectedRoute
  // redirects to login instead of showing a stuck "authenticated" state.
  useEffect(() => {
    return subscribeToken((token) => {
      if (token === null) {
        setAccount(null);
        queryClient.clear();
      }
    });
  }, []);
```

(Leave `login`/`logout`/`hydrate` as-is: `login` calls `setToken` with a non-null value, which the subscriber ignores.)

- [ ] **Step 6: Write the failing "mid-session 401" test**

Add to `auth.test.tsx`:

```tsx
test("a mid-session 401 (token cleared) drops auth and redirects to /login", async () => {
  localStorage.setItem("i2r_token", "tok.123"); // hydrates as super_admin via MSW /auth/me
  function AppRoutes() {
    return (
      <Routes>
        <Route path="/login" element={<div>Login screen</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin" element={<div>Secret admin</div>} />
        </Route>
      </Routes>
    );
  }
  wrap(<AppRoutes />, "/admin");
  expect(await screen.findByText("Secret admin")).toBeInTheDocument();
  act(() => clearToken()); // simulate the api-client clearing the token on a 401
  expect(await screen.findByText("Login screen")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run it — expect it to pass with the Step 5 wiring**

Run: `npm --prefix frontend test -- src/auth/auth.test.tsx -t "mid-session 401"`
Expected: PASS (redirect happens because `account` is cleared on token-null).

- [ ] **Step 8: Add location-preserving redirect + return-to**

In `frontend/src/auth/ProtectedRoute.tsx`, import `useLocation`, preserve the location, and style the not-authorized view:

```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import type { AccountRole } from "@/types/api";

export function ProtectedRoute({ requireRole }: { requireRole?: AccountRole }) {
  const { isAuthenticated, isLoading, role } = useAuth();
  const location = useLocation();
  if (isLoading) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (requireRole && role !== requireRole) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-muted-foreground">You don't have access to this area.</p>
      </div>
    );
  }
  return <Outlet />;
}
```

In `frontend/src/pages/LoginPage.tsx`, read the return-to and navigate to it (default `/admin`). Change the `useNavigate` import line and the success navigate:

```tsx
import { useLocation, useNavigate } from "react-router-dom";
```

```tsx
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const from = location.state?.from?.pathname ?? "/admin";
```

```tsx
      await login(email, password);
      navigate(from, { replace: true });
```

- [ ] **Step 9: Write the failing return-to test**

Add to `auth.test.tsx`:

```tsx
test("after login the user returns to the originally requested admin route", async () => {
  function AppRoutes() {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/owners" element={<div>Owners stub</div>} />
        </Route>
      </Routes>
    );
  }
  wrap(<AppRoutes />, "/admin/owners"); // unauth → redirected to /login carrying `from`
  await userEvent.type(await screen.findByLabelText(/email/i), "admin@example.com");
  await userEvent.type(screen.getByLabelText(/password/i), "pw");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText("Owners stub")).toBeInTheDocument();
});
```

- [ ] **Step 10: Run the full auth file + gate**

Run: `npm --prefix frontend test -- src/auth/auth.test.tsx`
Expected: PASS (all prior + 3 new tests).
Then: `npm --prefix frontend test` (full suite), `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/auth/token.ts frontend/src/auth/AuthProvider.tsx frontend/src/auth/ProtectedRoute.tsx frontend/src/pages/LoginPage.tsx frontend/src/auth/auth.test.tsx
git commit -m "feat(frontend): FE-3a auth hardening — 401→logout via token subscription + login return-to

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Admin shell (sidebar console) + role-aware nav

Rework `AdminLayout` into the dark-rail sidebar console with role-filtered nav; add the always-dark rail token and a `RolePill`.

**Files:**
- Modify: `frontend/src/index.css` (add `--admin-rail` token pair)
- Create: `frontend/src/components/RolePill.tsx`
- Modify: `frontend/src/layouts/AdminLayout.tsx`
- Test: `frontend/src/layouts/AdminLayout.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`account`, `role`, `logout`); `Badge`; React Router `NavLink`/`Outlet`.
- Produces: `RolePill({ role: AccountRole | null })`; reworked `AdminLayout` with nav items Home/Seasons/Owners/Accounts (Accounts `super_admin`-only) and `bg-admin-rail`.

- [ ] **Step 1: Add the always-dark rail token**

In `frontend/src/index.css`, add to the `@theme inline` block (near the other `--color-*` aliases):

```css
    --color-admin-rail: var(--admin-rail);
    --color-admin-rail-foreground: var(--admin-rail-foreground);
```

Add to **both** `:root` and `.dark` (identical values, so the rail is dark in both themes):

```css
    --admin-rail: oklch(0.208 0.042 265.75);
    --admin-rail-foreground: oklch(0.984 0.003 247.86);
```

- [ ] **Step 2: Create `RolePill`**

Create `frontend/src/components/RolePill.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { AccountRole } from "@/types/api";

const LABEL: Record<AccountRole, string> = {
  super_admin: "Super-admin",
  league_admin: "League-admin",
};

export function RolePill({ role }: { role: AccountRole | null }) {
  if (!role) return null;
  return <Badge variant="secondary">{LABEL[role]}</Badge>;
}
```

- [ ] **Step 3: Write the failing shell test**

Create `frontend/src/layouts/AdminLayout.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderShell() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<div>home content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("super-admin sees all nav sections including Accounts", async () => {
  renderShell();
  expect(await screen.findByRole("link", { name: "Accounts" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Seasons" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Owners" })).toBeInTheDocument();
  expect(screen.getByText("Super-admin")).toBeInTheDocument();
});

test("league-admin does not see the Accounts section", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderShell();
  expect(await screen.findByRole("link", { name: "Seasons" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull();
  expect(screen.getByText("League-admin")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/layouts/AdminLayout.test.tsx`
Expected: FAIL — current `AdminLayout` has no nav links / role pill.

- [ ] **Step 5: Rework `AdminLayout`**

Replace `frontend/src/layouts/AdminLayout.tsx`:

```tsx
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { RolePill } from "@/components/RolePill";

const NAV = [
  { to: "/admin", label: "Home", end: true },
  { to: "/admin/seasons", label: "Seasons" },
  { to: "/admin/owners", label: "Owners" },
  { to: "/admin/accounts", label: "Accounts", superOnly: true },
] as const;

export function AdminLayout() {
  const { account, role, logout } = useAuth();
  const items = NAV.filter((n) => !("superOnly" in n && n.superOnly) || role === "super_admin");

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
              end={"end" in n ? n.end : undefined}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-primary text-primary-foreground" : "hover:bg-white/10"
                }`
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

- [ ] **Step 6: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/layouts/AdminLayout.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full gate**

Run: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/index.css frontend/src/components/RolePill.tsx frontend/src/layouts/AdminLayout.tsx frontend/src/layouts/AdminLayout.test.tsx
git commit -m "feat(frontend): FE-3a admin shell — sidebar console + role-aware nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Admin home hub + section stubs + routes

Section-hub landing, reusable "coming soon" stub, and the admin child routes with role-gated Accounts.

**Files:**
- Create: `frontend/src/pages/admin/AdminHome.tsx`
- Create: `frontend/src/pages/admin/AdminSectionStub.tsx`
- Test: `frontend/src/pages/admin/AdminHome.test.tsx`
- Test: `frontend/src/pages/admin/admin-routes.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useAuth` (`account`, `role`); `AdminLayout`, `ProtectedRoute`; React Router `Link`.
- Produces: `AdminHome`, `AdminSectionStub({ title: string })`; admin subtree in `routes.tsx`.

- [ ] **Step 1: Write the failing hub test**

Create `frontend/src/pages/admin/AdminHome.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminHome } from "./AdminHome";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderHome() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuthProvider>
          <AdminHome />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("super-admin hub shows the Accounts card", async () => {
  renderHome();
  expect(await screen.findByRole("link", { name: /Accounts/ })).toHaveAttribute("href", "/admin/accounts");
  expect(screen.getByRole("link", { name: /Seasons/ })).toHaveAttribute("href", "/admin/seasons");
});

test("league-admin hub hides the Accounts card", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderHome();
  expect(await screen.findByRole("link", { name: /Seasons/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Accounts/ })).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/pages/admin/AdminHome.test.tsx`
Expected: FAIL — `./AdminHome` does not exist.

- [ ] **Step 3: Create the stub + hub**

Create `frontend/src/pages/admin/AdminSectionStub.tsx`:

```tsx
export function AdminSectionStub({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
```

Create `frontend/src/pages/admin/AdminHome.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

const SECTIONS = [
  { to: "/admin/seasons", title: "Seasons", desc: "Create & edit seasons, add leagues, sync, brackets." },
  { to: "/admin/owners", title: "Owners", desc: "Owner records & per-team mapping." },
  { to: "/admin/accounts", title: "Accounts", desc: "League-admin accounts & league grants.", superOnly: true },
] as const;

export function AdminHome() {
  const { account, role } = useAuth();
  const sections = SECTIONS.filter((s) => !("superOnly" in s && s.superOnly) || role === "super_admin");

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
            <h2 className="font-semibold text-primary">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/pages/admin/AdminHome.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route-gating test**

Create `frontend/src/pages/admin/admin-routes.test.tsx` (mirrors the admin subtree so the `requireRole` composition is exercised):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminHome } from "./AdminHome";
import { AdminSectionStub } from "./AdminSectionStub";
import { AuthProvider } from "@/auth/AuthProvider";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAdmin(initial: string) {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="owners" element={<AdminSectionStub title="Owners" />} />
              <Route element={<ProtectedRoute requireRole="super_admin" />}>
                <Route path="accounts" element={<AdminSectionStub title="Accounts" />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("super-admin can open the Accounts section", async () => {
  renderAdmin("/admin/accounts");
  expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
});

test("league-admin hitting Accounts sees Not authorized", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderAdmin("/admin/accounts");
  expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Wire the routes**

In `frontend/src/routes.tsx`: add imports and replace the `admin` route block.

Add imports:
```tsx
import { AdminHome } from "@/pages/admin/AdminHome";
import { AdminSectionStub } from "@/pages/admin/AdminSectionStub";
```

Replace the existing `admin` route object with:
```tsx
  {
    path: "admin",
    element: <ProtectedRoute />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminHome /> },
          { path: "seasons", element: <AdminSectionStub title="Seasons" /> },
          { path: "owners", element: <AdminSectionStub title="Owners" /> },
          {
            element: <ProtectedRoute requireRole="super_admin" />,
            children: [{ path: "accounts", element: <AdminSectionStub title="Accounts" /> }],
          },
        ],
      },
    ],
  },
```

- [ ] **Step 7: Run the gating test + full gate**

Run: `npm --prefix frontend test -- src/pages/admin/admin-routes.test.tsx`
Expected: PASS (2 tests).
Then: `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/AdminHome.tsx frontend/src/pages/admin/AdminSectionStub.tsx frontend/src/pages/admin/AdminHome.test.tsx frontend/src/pages/admin/admin-routes.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3a admin home hub + section stubs + role-gated routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`API_PROXY_TARGET=http://localhost:8123 npm --prefix frontend run dev` against the running backend on `:8123`), log in with a seeded admin account, and verify the admin shell in light AND dark — dark rail contrast, amber `ADMIN` wordmark, active-nav blue, role pill, hub cards. Confirm a league-admin login hides Accounts and that letting the token expire bounces you to `/login`.
- **PR:** open a PR from `plan/fe-3a-admin-shell` → `main` per [[git-workflow]]. No sensitive data.

## Self-review notes (author check)

- Spec coverage: auth hardening — token subscription + account/cache clear + return-to (Task 1); sidebar-console shell + always-dark rail token + role-aware nav + role pill (Task 2); section-hub home + stubs + role-gated `/admin/accounts` route (Task 3). Non-goals (real CRUD, dashboard, password flows) excluded.
- Type consistency: `subscribeToken`, `RolePill`, `AdminHome`, `AdminSectionStub`, `AccountRole` values (`super_admin`/`league_admin`), and route paths match across tasks.
- No placeholders: every code step shows full code; every run step shows command + expected result. Commit steps stage only their own files (working tree has unrelated pending changes).
