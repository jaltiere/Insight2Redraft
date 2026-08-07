# Frontend Foundation (FE-0) — Design

**Date:** 2026-08-07
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Stand up the React frontend project and the core plumbing every page will build
on: a Vite + React + TypeScript app under `frontend/`, routing, a typed API
client, TanStack Query, auth (login + JWT + role-aware route guards), an app
shell, a styling/testing baseline, and one real data-backed page (the public
seasons list) that proves the whole stack end-to-end. Real page and visual
design land in later frontend cycles.

This is the first of the decomposed **frontend** cycles:

- **FE-0 (this spec)** — foundation / scaffold.
- **FE-1 (later)** — public site (season dashboard, leagues, owner profiles,
  hall of fame).
- **FE-2 (later)** — the super-bracket view.
- **FE-3 (later)** — the login-gated, role-aware admin area (covers every admin
  endpoint; see [[admin-capabilities-need-ui]]).

## Stack Decisions (settled)

- **TypeScript** (typed over the API JSON contract).
- **Vite + React 18**, package manager **npm** (Node 22 / npm 10 available).
- **Tailwind CSS + shadcn/ui** (accessible Radix components copied into the repo;
  a few base components to start).
- **React Router v6** for routing; **TanStack Query** for server state.
- **Vitest + React Testing Library + MSW** for tests (MSW mocks the backend; no
  live server in tests).
- **JWT in `localStorage`** (pragmatic for an admin-only 12h-expiry token; known
  XSS caveat accepted for the small trusted admin audience).

## Goals

- A running, buildable `frontend/` app: `npm run dev`, `npm run build` (tsc +
  vite), `npm test` (Vitest), `npm run lint` all green.
- A typed API client that attaches the bearer token and surfaces typed errors,
  configured via `VITE_API_BASE_URL` with a Vite dev proxy to the backend.
- Auth: login, token persistence, `AuthProvider` hydrating the account via
  `GET /auth/me`, `useAuth()`, `ProtectedRoute` + a role-aware guard, logout.
- One real page (public seasons list, `GET /seasons`) rendered through the API
  client + React Query with loading/error/empty states.
- Test coverage of the auth flow, route guards, and the seasons page.

## Non-Goals (this cycle)

- No real FE-1/FE-2/FE-3 pages beyond the seasons proof-of-life.
- No visual/brand design system beyond shadcn/ui defaults (light theme to start).
- No live Railway deploy (config included; wiring deferred).
- No e2e (Playwright) — component/integration tests via Vitest + MSW only.
- No codegen of TS types from the backend (OpenAPI) — hand-written types for the
  endpoints FE-0 touches; revisit codegen if drift becomes a problem.
- No refresh-token flow (backend has none); a 401 clears the token and bounces
  to login.

## Backend Contract (grounding)

The backend (all merged) serves the API this consumes. FE-0 touches:
- `POST /auth/login` `{email, password}` → `{access_token, token_type}` (401 on
  bad credentials).
- `GET /auth/me` (Bearer) → `{id, email, role, owner_id}` (401 without/expired
  token).
- `GET /seasons` (public, no auth) → `[{id, year, status}]`.
- Roles: `super_admin` | `league_admin`. Admin endpoints require the bearer
  token; public reads do not. Dev backend runs on `localhost:8000`.

## Project Structure

`frontend/` at the repo root:

```
frontend/
  index.html
  package.json  vite.config.ts  tsconfig.json  tailwind.config.js
  .env.example                 # VITE_API_BASE_URL=http://localhost:8000
  src/
    main.tsx                   # React root: QueryClientProvider, RouterProvider, AuthProvider
    App.tsx / routes.tsx       # route tree (public + protected)
    lib/
      api-client.ts            # typed fetch wrapper (bearer, base URL, ApiError)
      queryClient.ts           # TanStack QueryClient
    types/
      api.ts                   # hand-written response types (Account, SeasonSummary, ...)
    auth/
      AuthProvider.tsx         # context: account, login(), logout(); hydrates via /auth/me
      useAuth.ts
      ProtectedRoute.tsx       # redirect unauth -> /login; role-aware variant
      token.ts                 # localStorage get/set/clear
    components/ui/             # shadcn components (button, input, card, table, ...)
    layouts/
      PublicLayout.tsx         # header/nav + <Outlet/>
      AdminLayout.tsx          # authed shell with logout (used by FE-3)
    pages/
      SeasonsPage.tsx          # proof-of-life: lists /seasons
      LoginPage.tsx
    test/
      setup.ts                 # RTL + jest-dom + MSW server lifecycle
      server.ts                # MSW handlers
```

Each file has one clear responsibility; pages stay thin (fetch via a hook,
render). Keep files focused and small.

## API Client & Data Layer

- `api-client.ts`: a small typed wrapper over `fetch`. Reads
  `import.meta.env.VITE_API_BASE_URL`, prefixes paths, sets `Content-Type`,
  attaches `Authorization: Bearer <token>` when a token is present. Non-2xx →
  throw a typed `ApiError {status, detail}`. A `401` clears the stored token and
  signals the auth layer to redirect to `/login`.
- `queryClient.ts`: a `QueryClient` with sensible defaults (no aggressive
  refetch for FE-0; per-query tuning later, e.g. the live bracket).
- Feature hooks wrap queries, e.g. `useSeasons()` → `useQuery(['seasons'], () =>
  apiClient.get<SeasonSummary[]>('/seasons'))`.
- `types/api.ts`: `Account {id, email, role: 'super_admin'|'league_admin',
  owner_id: number|null}`, `SeasonSummary {id, year, status}`,
  `LoginResponse {access_token, token_type}`, `ApiError`.

## Auth

- `token.ts`: `getToken()/setToken()/clearToken()` over `localStorage`
  (key `i2r_token`).
- `AuthProvider`: on mount, if a token exists, fetches `GET /auth/me`; on success
  sets `account`, on 401 clears the token. Exposes `login(email, password)`
  (calls `/auth/login`, stores the token, hydrates the account) and `logout()`
  (clears token + account). While hydrating, renders a lightweight loading state.
- `useAuth()`: `{account, role, isAuthenticated, isLoading, login, logout}`.
- `ProtectedRoute`: if not authenticated → `<Navigate to="/login" replace/>`;
  else render `<Outlet/>`. A `requireRole="super_admin"` variant renders a
  "not authorized" state (or redirect) for a league-admin. (FE-3 uses these; FE-0
  ships them with tests.)
- Route tree: `/` (public seasons via `PublicLayout`), `/login`, and a sample
  `/admin` protected route wrapping `AdminLayout` to prove the guard end-to-end.

## Styling

- Tailwind configured; shadcn/ui initialized (neutral/slate base, light theme).
- Base components generated into `components/ui/`: `button`, `input`, `card`,
  `table` (enough for the seasons list, login form, and FE-1/FE-3 reuse).
- `PublicLayout` provides a simple header (site title + nav placeholder) and a
  content `Outlet`. No brand/visual system beyond shadcn defaults this cycle.

## Testing Strategy

Vitest + React Testing Library + MSW. `test/server.ts` defines MSW handlers for
`/auth/login`, `/auth/me`, `/seasons`; `test/setup.ts` starts/stops the server
and resets handlers per test.

- **API client**: attaches the bearer when a token is set; throws `ApiError` with
  the status on a non-2xx; a 401 clears the token.
- **Auth**: `login()` stores the token and populates `account`; a failed login
  surfaces an error and stores nothing; `AuthProvider` hydrates from `/auth/me`
  when a token is present and clears a rejected token; `logout()` clears both.
- **Route guards**: `ProtectedRoute` redirects to `/login` when unauthenticated
  and renders the outlet when authenticated; the `requireRole` variant blocks a
  league-admin from a super-admin route.
- **Login page**: submitting valid credentials navigates to `/` (or the intended
  route); invalid shows the error message.
- **Seasons page**: renders rows from a mocked `GET /seasons`; shows the loading
  state, and an error state when the endpoint 500s.
- **Compile gate**: `npm run build` (tsc + vite) succeeds; `npm run lint` clean.

## Deployment (config only)

Railway static SPA: `npm run build` → `dist/` served statically with SPA
fallback (all routes → `index.html`). API base from `VITE_API_BASE_URL` at build
time. FE-0 includes the build config and an `.env.example`; wiring a live Railway
service is deferred.

## Files & Tasks (3)

- **Task 1 — Scaffold**: create the Vite+React+TS project, Tailwind + shadcn/ui
  init, Vitest+RTL+MSW config, npm scripts (`dev`/`build`/`test`/`lint`), a smoke
  test. App boots, builds, and the smoke test passes.
- **Task 2 — API client + data layer + seasons page**: `api-client.ts`,
  `queryClient.ts`, `types/api.ts`, `useSeasons`, `SeasonsPage`, `PublicLayout`,
  wired into the router; MSW-backed tests.
- **Task 3 — Auth**: `token.ts`, `AuthProvider`, `useAuth`, `ProtectedRoute`
  (+ role variant), `LoginPage`, `AdminLayout`, a sample protected route; tests.

## Constraints

- All frontend commands run from `frontend/` (the backend keeps its own `uv`
  toolchain under `backend/`). Node 22 / npm 10.
- Type-safe: no `any` on API boundaries; response types live in `types/api.ts`.
- Tests never hit a live backend — MSW only.
- `frontend/node_modules`, `dist`, and local `.env` are git-ignored.
- The app must build (`npm run build`) and pass `npm test` + `npm run lint` at
  the end of each task.
