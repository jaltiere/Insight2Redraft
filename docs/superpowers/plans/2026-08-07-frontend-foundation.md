# Frontend Foundation (FE-0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, buildable `frontend/` React app with a typed API client, TanStack Query, auth (login + localStorage JWT + role-aware guards), an app shell, and a public seasons page proving the whole stack — with tests.

**Architecture:** Vite + React 19 + TypeScript under `frontend/`. Tailwind CSS v4 (`@tailwindcss/vite` plugin) + shadcn/ui. React Router v7 as an SPA library (`createBrowserRouter` + `RouterProvider`). TanStack Query for server state. Vitest + React Testing Library + MSW for tests (no live backend).

**Tech Stack (pinned at planning time):** Vite 8, React 19, TypeScript, Tailwind 4, shadcn (CLI 4), react-router-dom 7, @tanstack/react-query 5, Vitest 4, @testing-library/react 16, MSW 2, jsdom 30. Node 22 / npm 10.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-frontend-foundation-design.md`. Deviations need sign-off.
- **All frontend commands run from `frontend/`** (the backend keeps its own `uv` toolchain under `backend/`). Never mix the two toolchains.
- At the END of every task: `npm run build` (tsc + vite), `npm test` (`vitest run`), and `npm run lint` must all pass.
- Type-safe: **no `any` on API boundaries**; response types live in `src/types/api.ts`.
- **Tests never hit a live backend** — MSW intercepts all requests.
- API base URL comes from `import.meta.env.VITE_API_BASE_URL` (default `/api`, proxied to the backend in dev). The `@/` path alias maps to `src/`.
- **Scaffolding note (Task 1):** the CLI tools (`npm create vite`, `npx shadcn init`) are interactive and version-sensitive. Run them, accept the defaults this plan names, and verify the resulting files. If a CLI's flow materially differs from what's written here (a renamed flag, a different prompt), adapt to the actual tool, keep the intended outcome, and report it as DONE_WITH_CONCERNS with what differed. The hand-written source in Tasks 2–3 is exact and must match.
- `frontend/node_modules`, `frontend/dist`, and local env files (`.env`, `.env.local`) are git-ignored. **`.env.example` and `.env.test` ARE committed** (the test base URL is shared test config). The Vite template ships a `.gitignore`; confirm it ignores `node_modules`/`dist` and does not ignore `.env.test`/`.env.example` (adjust if the template's `.env` glob is too broad).

## File Structure

```
frontend/
  package.json  vite.config.ts  tsconfig.json  tsconfig.app.json  components.json
  vitest.setup.ts  .env.example  index.html  eslint.config.js
  src/
    main.tsx  routes.tsx  index.css
    lib/{api-client.ts, queryClient.ts, utils.ts}
    types/api.ts
    auth/{token.ts, AuthProvider.tsx, useAuth.ts, ProtectedRoute.tsx}
    components/ui/{button,input,card,table}.tsx   # shadcn-generated
    layouts/{PublicLayout.tsx, AdminLayout.tsx}
    pages/{SeasonsPage.tsx, LoginPage.tsx}
    features/{useSeasons.ts}
    test/{server.ts, handlers.ts}
```

---

### Task 1: Scaffold the project + tooling

**Files:** Create the `frontend/` project and its config. No hand-written app logic yet beyond a smoke test.

**Interfaces produced:** a working npm project with scripts `dev`, `build`, `test`, `lint`; Tailwind v4 + shadcn/ui configured; the `@/` alias; a `/api` dev proxy; Vitest + RTL + jsdom set up; base shadcn components (`button`, `input`, `card`, `table`).

- [ ] **Step 1: Create the Vite React-TS project**

From the repo root:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

This scaffolds React 19 + TypeScript + Vite. All remaining steps run from `frontend/`.

- [ ] **Step 2: Add Tailwind v4 and the path alias**

```bash
npm install tailwindcss @tailwindcss/vite
```

Replace `src/index.css` with just:

```css
@import "tailwindcss";
```

Add the `@/` alias so shadcn and imports resolve. In `tsconfig.app.json`, add to `compilerOptions`:

```jsonc
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
```

(Also add the same `baseUrl`/`paths` to `tsconfig.json`'s `compilerOptions` if shadcn's init reads it — shadcn checks `tsconfig.json`.)

Overwrite `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    css: true,
  },
});
```

- [ ] **Step 3: Initialize shadcn/ui and add base components**

```bash
npx shadcn@latest init
```

Accept the defaults (base color **Neutral**, CSS variables **yes**). shadcn detects Tailwind v4, writes `components.json`, injects CSS variables/theme into `src/index.css`, and creates `src/lib/utils.ts`. Then add the base components:

```bash
npx shadcn@latest add button input card table
```

These land in `src/components/ui/`. (If the CLI prompts differ, accept the equivalent defaults and note it.)

- [ ] **Step 4: Add the testing toolchain**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Wire npm scripts and env**

In `package.json`, set the `scripts` block to:

```jsonc
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  }
```

Create `.env.example`:

```
VITE_API_BASE_URL=/api
```

Create `.env.test` (tests run under Node's `fetch`/undici, which rejects relative URLs — an **absolute** base is required so requests parse; MSW matches by path regardless of origin):

```
VITE_API_BASE_URL=http://localhost/api
```

- [ ] **Step 6: Write the smoke test**

Replace `src/App.tsx` with a trivial component:

```tsx
export default function App() {
  return <h1>Insight2Redraft</h1>;
}
```

Create `src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App";

test("renders the app title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /insight2redraft/i })).toBeInTheDocument();
});
```

Trim `src/main.tsx` to render `<App />` (remove the Vite demo CSS import of `App.css` if present; keep `index.css`).

- [ ] **Step 7: Verify the toolchain**

```bash
npm test        # smoke test passes
npm run build   # tsc + vite build succeed
npm run lint    # clean
```

Expected: all three green. Fix any config issues (alias, tailwind plugin, vitest env) until they are.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold Vite + React + TS with Tailwind v4, shadcn, Vitest"
```

---

### Task 2: API client + data layer + public seasons page

**Files:**
- Create: `src/lib/api-client.ts`, `src/lib/queryClient.ts`, `src/types/api.ts`, `src/features/useSeasons.ts`, `src/layouts/PublicLayout.tsx`, `src/pages/SeasonsPage.tsx`, `src/routes.tsx`, `src/test/handlers.ts`, `src/test/server.ts`, `src/pages/SeasonsPage.test.tsx`, `src/lib/api-client.test.ts`
- Modify: `src/main.tsx`, `vitest.setup.ts`

**Interfaces:**
- Produces: `apiClient` (`get<T>`, `post<T>` attaching the bearer token, throwing `ApiError`); `queryClient`; types `SeasonSummary`, `SeasonStatus`, `Account`, `LoginResponse`, `ApiError`; `useSeasons()`; `<SeasonsPage/>`, `<PublicLayout/>`; the router.
- Consumes: `getToken()` — for FE-0 stub it inline (`localStorage.getItem("i2r_token")`); Task 3 replaces the import with `@/auth/token`.

- [ ] **Step 1: Write the response types**

Create `src/types/api.ts`:

```ts
export type SeasonStatus = "setup" | "regular" | "playoffs" | "complete";

export interface SeasonSummary {
  id: number;
  year: number;
  status: SeasonStatus;
}

export type AccountRole = "super_admin" | "league_admin";

export interface Account {
  id: number;
  email: string;
  role: AccountRole;
  owner_id: number | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface ApiError {
  status: number;
  detail: string;
}
```

- [ ] **Step 2: Write the failing api-client test**

Create `src/lib/api-client.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { apiClient, isApiError } from "./api-client";
import { server } from "@/test/server";

describe("apiClient", () => {
  afterEach(() => localStorage.clear());

  it("returns parsed JSON on success", async () => {
    server.use(http.get("/api/seasons", () => HttpResponse.json([{ id: 1, year: 2024, status: "regular" }])));
    const data = await apiClient.get<{ id: number }[]>("/seasons");
    expect(data[0].id).toBe(1);
  });

  it("attaches the bearer token when present", async () => {
    localStorage.setItem("i2r_token", "abc.def");
    let seen: string | null = null;
    server.use(http.get("/api/me", ({ request }) => {
      seen = request.headers.get("authorization");
      return HttpResponse.json({ ok: true });
    }));
    await apiClient.get("/me");
    expect(seen).toBe("Bearer abc.def");
  });

  it("throws an ApiError with the status on non-2xx", async () => {
    server.use(http.get("/api/nope", () => HttpResponse.json({ detail: "boom" }, { status: 404 })));
    await expect(apiClient.get("/nope")).rejects.toMatchObject({ status: 404, detail: "boom" });
    try {
      await apiClient.get("/nope");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Add MSW server plumbing**

Create `src/test/handlers.ts`:

```ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/seasons", () =>
    HttpResponse.json([
      { id: 1, year: 2024, status: "regular" },
      { id: 2, year: 2023, status: "complete" },
    ]),
  ),
];
```

Create `src/test/server.ts`:

```ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

Append to `vitest.setup.ts`:

```ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/test/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- [ ] **Step 4: Implement the api client**

Create `src/lib/api-client.ts`:

```ts
import type { ApiError } from "@/types/api";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "status" in e && "detail" in e;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("i2r_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    localStorage.removeItem("i2r_token");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && typeof data.detail === "string") detail = data.detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    const err: ApiError = { status: res.status, detail };
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
};
```

- [ ] **Step 5: Run the api-client test**

Run: `npm test -- api-client`
Expected: 3 passing.

- [ ] **Step 6: Write the failing seasons-page test**

Create `src/pages/SeasonsPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SeasonsPage } from "./SeasonsPage";
import { server } from "@/test/server";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeasonsPage />
    </QueryClientProvider>,
  );
}

test("renders seasons from the API", async () => {
  renderPage();
  expect(await screen.findByText("2024")).toBeInTheDocument();
  expect(screen.getByText("2023")).toBeInTheDocument();
});

test("shows an error state when the request fails", async () => {
  server.use(http.get("/api/seasons", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
  renderPage();
  expect(await screen.findByText(/couldn't load seasons/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Implement the query hook, page, layout, query client, router**

Create `src/lib/queryClient.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
```

Create `src/features/useSeasons.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { SeasonSummary } from "@/types/api";

export function useSeasons() {
  return useQuery({
    queryKey: ["seasons"],
    queryFn: () => apiClient.get<SeasonSummary[]>("/seasons"),
  });
}
```

Create `src/pages/SeasonsPage.tsx`:

```tsx
import { useSeasons } from "@/features/useSeasons";

export function SeasonsPage() {
  const { data, isPending, isError } = useSeasons();

  if (isPending) return <p>Loading seasons…</p>;
  if (isError) return <p>Couldn't load seasons.</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold">Seasons</h2>
      <ul>
        {data.map((s) => (
          <li key={s.id}>
            {s.year} — {s.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `src/layouts/PublicLayout.tsx`:

```tsx
import { Outlet } from "react-router-dom";

export function PublicLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-3">
        <span className="font-bold">Insight2Redraft</span>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
```

Create `src/routes.tsx`:

```tsx
import { createBrowserRouter } from "react-router-dom";
import { PublicLayout } from "@/layouts/PublicLayout";
import { SeasonsPage } from "@/pages/SeasonsPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [{ index: true, element: <SeasonsPage /> }],
  },
]);
```

Overwrite `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "@/lib/queryClient";
import { router } from "@/routes";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

Install the runtime deps if not already present:

```bash
npm install @tanstack/react-query react-router-dom
```

- [ ] **Step 8: Run the tests + build**

Run: `npm test`
Expected: api-client (3) + seasons page (2) + smoke (1) all pass.

Run: `npm run build && npm run lint`
Expected: both green.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(frontend): typed API client, React Query, public seasons page"
```

---

### Task 3: Auth — login, token storage, guards, admin shell

**Files:**
- Create: `src/auth/token.ts`, `src/auth/AuthProvider.tsx`, `src/auth/useAuth.ts`, `src/auth/ProtectedRoute.tsx`, `src/pages/LoginPage.tsx`, `src/layouts/AdminLayout.tsx`, `src/auth/auth.test.tsx`
- Modify: `src/lib/api-client.ts` (use `token.ts`), `src/routes.tsx` (add `/login` + a protected `/admin`), `src/main.tsx` (wrap in `AuthProvider`), `src/test/handlers.ts` (add auth handlers)

**Interfaces:**
- Produces: `getToken/setToken/clearToken`; `AuthProvider`; `useAuth() -> {account, role, isAuthenticated, isLoading, login, logout}`; `<ProtectedRoute requireRole?>`; `<LoginPage/>`, `<AdminLayout/>`.

- [ ] **Step 1: Token helpers**

Create `src/auth/token.ts`:

```ts
const KEY = "i2r_token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);
```

Update `src/lib/api-client.ts` to use it: replace the two inline `localStorage` calls with `getToken()` and `clearToken()` (add `import { clearToken, getToken } from "@/auth/token";`).

- [ ] **Step 2: Write the failing auth tests**

Add auth handlers to `src/test/handlers.ts` (append to the `handlers` array):

```ts
  http.post("/api/auth/login", async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    if (email === "admin@example.com" && password === "pw") {
      return HttpResponse.json({ access_token: "tok.123", token_type: "bearer" });
    }
    return HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 });
  }),
  http.get("/api/auth/me", ({ request }) => {
    if (request.headers.get("authorization") === "Bearer tok.123") {
      return HttpResponse.json({ id: 1, email: "admin@example.com", role: "super_admin", owner_id: null });
    }
    return HttpResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }),
```

Create `src/auth/auth.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "./useAuth";
import { LoginPage } from "@/pages/LoginPage";

afterEach(() => localStorage.clear());

function wrap(ui: ReactNode, initial = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function Protected() {
  return (
    <Routes>
      <Route path="/login" element={<div>Login screen</div>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Secret</div>} />
      </Route>
    </Routes>
  );
}

test("protected route redirects to /login when unauthenticated", async () => {
  wrap(<Protected />, "/");
  expect(await screen.findByText("Login screen")).toBeInTheDocument();
});

test("login stores the token and authenticates", async () => {
  function Probe() {
    const { isAuthenticated, login } = useAuth();
    return (
      <div>
        <span>{isAuthenticated ? "in" : "out"}</span>
        <button onClick={() => login("admin@example.com", "pw")}>go</button>
      </div>
    );
  }
  wrap(<Probe />);
  await screen.findByText("out");
  await userEvent.click(screen.getByRole("button", { name: "go" }));
  await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
  expect(localStorage.getItem("i2r_token")).toBe("tok.123");
});

test("login page shows an error on bad credentials", async () => {
  wrap(<LoginPage />, "/login");
  await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
  await userEvent.type(screen.getByLabelText(/password/i), "wrong");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement the auth context**

Create `src/auth/AuthProvider.tsx`:

```tsx
import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiClient } from "@/lib/api-client";
import { clearToken, getToken, setToken } from "@/auth/token";
import type { Account } from "@/types/api";

interface AuthContextValue {
  account: Account | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      if (!getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await apiClient.get<Account>("/auth/me");
        if (active) setAccount(me);
      } catch {
        clearToken();
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.post<{ access_token: string }>("/auth/login", { email, password });
    setToken(res.access_token);
    const me = await apiClient.get<Account>("/auth/me");
    setAccount(me);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAccount(null);
  }, []);

  const value = useMemo(() => ({ account, isLoading, login, logout }), [account, isLoading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

Create `src/auth/useAuth.ts`:

```ts
import { useContext } from "react";
import { AuthContext } from "@/auth/AuthProvider";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return {
    account: ctx.account,
    role: ctx.account?.role ?? null,
    isAuthenticated: ctx.account !== null,
    isLoading: ctx.isLoading,
    login: ctx.login,
    logout: ctx.logout,
  };
}
```

Create `src/auth/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import type { AccountRole } from "@/types/api";

export function ProtectedRoute({ requireRole }: { requireRole?: AccountRole }) {
  const { isAuthenticated, isLoading, role } = useAuth();
  if (isLoading) return <p>Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (requireRole && role !== requireRole) return <p>Not authorized.</p>;
  return <Outlet />;
}
```

- [ ] **Step 4: Implement the login page + admin shell**

Create `src/pages/LoginPage.tsx`:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { isApiError } from "@/lib/api-client";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err.detail : "Login failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-16 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <label className="flex flex-col gap-1">
        Email
        <input className="border p-2" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Password
        <input
          className="border p-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="border p-2" type="submit">
        Sign in
      </button>
    </form>
  );
}
```

Create `src/layouts/AdminLayout.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

export function AdminLayout() {
  const { account, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-bold">Admin</span>
        <div className="flex items-center gap-3">
          <span className="text-sm">{account?.email}</span>
          <button className="text-sm underline" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Wire routes + AuthProvider**

Update `src/routes.tsx` to add `/login` and a protected `/admin`:

```tsx
import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { LoginPage } from "@/pages/LoginPage";
import { SeasonsPage } from "@/pages/SeasonsPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <SeasonsPage /> },
      { path: "login", element: <LoginPage /> },
    ],
  },
  {
    path: "admin",
    element: <ProtectedRoute />,
    children: [{ element: <AdminLayout />, children: [{ index: true, element: <p>Admin home</p> }] }],
  },
]);
```

Wrap the app in `AuthProvider` in `src/main.tsx` (inside `QueryClientProvider`, around `RouterProvider`):

```tsx
import { AuthProvider } from "@/auth/AuthProvider";
```
```tsx
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
```

- [ ] **Step 6: Run the auth tests**

Run: `npm test -- auth`
Expected: 3 passing.

- [ ] **Step 7: Run the full suite + build + lint**

Run: `npm test`
Expected: all pass (smoke + api-client 3 + seasons 2 + auth 3).

Run: `npm run build && npm run lint`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): auth — login, token storage, route guards, admin shell"
```

---

## Verification (whole branch)

- From `frontend/`: `npm test` (all green), `npm run build` (tsc + vite succeed), `npm run lint` (clean).
- Manual smoke (optional, needs the backend running on :8000): `npm run dev`, open the app → the home page lists seasons from the API; `/login` with a real super-admin (created via the API-1 CLI) authenticates and lands on `/admin`; refreshing keeps you logged in (token in localStorage, `/auth/me` rehydrates); "Log out" clears it; visiting `/admin` while logged out redirects to `/login`.
