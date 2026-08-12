# FE-3a: Admin Shell + Auth Hardening — Design

Date: 2026-08-12
Track: Frontend admin area (FE-3), first slice. Follows FE-0/1a/1/1b (public site).
Branch: `plan/fe-3a-admin-shell`

## Goal

Stand up the authenticated **admin area foundation**: a distinct, role-aware
admin shell, a hardened auth/session flow, and a section-hub landing — the shell
that every later admin slice (seasons, owners, accounts, brackets) fills in.

**Foundation only.** No real admin CRUD in this slice; the section destinations
are "coming soon" stubs. Real capabilities land in FE-3b+ (see
[[admin-capabilities-need-ui]] for the full backlog).

## Why now / prerequisite

The FE-0 review flagged a real bug that blocks authenticated admin pages: on a
mid-session **401**, `api-client` clears the token but nothing clears
`AuthProvider.account`, so `isAuthenticated` stays `true` and the user is never
redirected to login. This slice fixes that before any admin page fetches
authenticated data.

## Existing pieces (what we build on)

- **Backend auth (shipped):** `POST /auth/login` → `{ access_token }`;
  `GET /auth/me` → `Account { id, email, role, owner_id }`. Role is
  `"super_admin" | "league_admin"`. JWT stored in `localStorage` key `i2r_token`.
- **`api-client`** (`@/lib/api-client`): attaches the bearer token, throws
  `ApiError { status, detail }`, and **already calls `clearToken()` on 401**.
- **`token.ts`**: `getToken`/`setToken`/`clearToken` over `localStorage`.
- **`AuthProvider`/`useAuth`**: hydrates `account` from `/auth/me`; exposes
  `account`, `role`, `isAuthenticated`, `isLoading`, `login`, `logout`.
- **`ProtectedRoute({ requireRole? })`**: redirects to `/login` when
  unauthenticated; renders "Not authorized." on role mismatch. Role-gating is
  present but **untested**; the redirect does not preserve the target route.
- **`LoginPage`**: works, but hardcodes `navigate("/admin")` after login.
- **`AdminLayout`**: minimal placeholder header ("Admin" + email + logout).
- **Theme:** Broadcast-Blue tokens, light+dark (see [[frontend-foundation]]).

No backend changes.

## Admin identity (decided via visual brainstorm)

Sidebar **console** shell — same theme/components as the public site, but
unmistakably admin:

- A **dark slate left nav rail** (`--sidebar`/slate tokens) with an
  `I2R ADMIN` wordmark (amber `--highlight` accent on "ADMIN").
- Nav items: **Home · Seasons · Owners · Accounts**, active item highlighted in
  primary blue.
- Rail footer: signed-in email + a **role pill** (SUPER-ADMIN / LEAGUE-ADMIN) +
  Log out.
- Main content area renders the routed page.
- **Role-aware nav:** `Accounts` shows for `super_admin` only. (League-admins
  also see only their granted leagues once Seasons is real — not in this slice.)

Landing = **section hub**: role-filtered cards (Seasons, Owners, Accounts)
linking to the stub routes, with a short signed-in context line.

Built from existing design tokens (add admin-specific token aliases only if a
rail color isn't already covered). Must resolve in light + dark. The rail
collapses/stacks on narrow screens.

## Architecture

### Auth hardening — token-change subscription (chosen approach)

Make `token.ts` the single source of truth and let it notify on change; the
`api-client`'s existing 401 → `clearToken()` path then propagates to auth state.

- **`token.ts`** gains a tiny subscription:
  - `setToken`/`clearToken` call an internal `notify()` after mutating storage.
  - `subscribeToken(listener: (token: string | null) => void): () => void`
    registers/*returns an unsubscribe*. (Module-level `Set` of listeners.)
- **`AuthProvider`** subscribes on mount. When the token transitions to `null`
  while `account` is set (i.e. a mid-session 401, or an explicit `logout`), it
  `setAccount(null)` and clears the React Query cache (`queryClient.clear()`)
  so no stale authenticated data lingers. Unsubscribe on unmount.
  - `login()` (`setToken` then `setAccount`) is unaffected: the subscriber only
    acts on the **null** transition, so a fresh non-null token is a no-op.
- **`ProtectedRoute`** then redirects on the next render because
  `isAuthenticated` flips to `false`.

Rejected alternatives: React Query `QueryCache.onError` (misses non-query calls,
still needs an out-of-tree logout hook); an api-client `onUnauthorized` callback
(equivalent to this but keyed off the client rather than the token — the token
is the truer source).

### Routing & role-gating

`ProtectedRoute` preserves the requested location so login can return to it:

```
/admin                      → ProtectedRoute → AdminLayout
  index                     → AdminHome (hub)
  seasons                   → AdminSectionStub "Seasons"
  owners                    → AdminSectionStub "Owners"
  (ProtectedRoute requireRole="super_admin")
    accounts                → AdminSectionStub "Accounts"
```

- Unauthenticated hit on any `/admin/*` → `<Navigate to="/login" replace>` with
  the attempted location in router state.
- `LoginPage` reads that location and navigates back to it after login
  (default `/admin`).
- Role mismatch on `accounts` → a styled "Not authorized" view (super-admin
  only), and the `Accounts` nav item is not rendered for league-admins.

### Components / files

- `src/auth/token.ts` — add `subscribeToken` + `notify` (modify).
- `src/auth/AuthProvider.tsx` — subscribe; clear account + query cache on
  token-null (modify).
- `src/auth/ProtectedRoute.tsx` — preserve location; styled not-authorized
  (modify).
- `src/pages/LoginPage.tsx` — return-to redirect (modify).
- `src/layouts/AdminLayout.tsx` — sidebar console, role-aware nav (rework).
- `src/pages/admin/AdminHome.tsx` — section-hub landing (create).
- `src/pages/admin/AdminSectionStub.tsx` — reusable "coming soon" placeholder
  for Seasons/Owners/Accounts (create).
- `src/routes.tsx` — admin child routes + role-gated accounts (modify).
- Possibly `src/components/RolePill.tsx` and a small nav primitive if it keeps
  `AdminLayout` focused (implementer's judgment).

## States & errors

- `ProtectedRoute`: `isLoading` → loading; unauthenticated → redirect (with
  return-to); role mismatch → not-authorized view.
- `AdminLayout`: always has an `account` (it renders inside `ProtectedRoute`),
  so the role pill/email are safe to read.
- Mid-session 401 anywhere under `/admin` → account cleared → redirect to login;
  after re-login, return to the page they were on.

## Testing (Vitest + RTL + MSW)

Honor the baked-in gotchas (`.env.test` absolute base URL, jsdom origin,
`import type`). New/updated tests:

- **token subscription:** `subscribeToken` fires on `setToken`/`clearToken` with
  the new value; unsubscribe stops delivery.
- **mid-session 401 → logout+redirect:** authenticated render under `/admin`;
  trigger a 401 (a request that `clearToken()`s, or call `clearToken()`
  directly to simulate the api-client path); assert `account` cleared and a
  redirect to `/login`.
- **`requireRole`:** a `league_admin` hitting `/admin/accounts` sees
  "Not authorized"; a `super_admin` sees the Accounts stub.
- **role-aware nav:** `AdminLayout` renders the `Accounts` link for
  `super_admin`, hides it for `league_admin`; both see Home/Seasons/Owners.
- **login return-to:** visiting `/admin/owners` while unauthenticated redirects
  to `/login`; after a successful login the user lands on `/admin/owners`
  (default `/admin` when there was no target).
- **hub:** `AdminHome` renders the role-correct set of section cards.

Tests assert behavior (redirects, rendered nav items/cards, accessible text),
not mocks.

## Non-goals (deferred)

- Any real season / owner / account / grant / bracket CRUD — stubs only
  (FE-3b+).
- Operational/overview dashboard on the admin home (section hub only for now).
- Password-reset / account self-service flows.
- League-admin "only my leagues" filtering of real data (arrives with the real
  Seasons/Leagues pages).

## Definition of done

- `frontend/`: `npm run build`, `npm test`, `npm run lint` all green.
- A 401 mid-session reliably lands the user back on `/login` (no stuck session).
- Admin area is visibly, unmistakably "admin" (sidebar console) in light + dark;
  nav + hub are role-aware.
- Human eyeball of the admin shell light + dark (needs a running backend + a
  seeded admin account to log in; otherwise the login form + gating are the
  visible surface).
