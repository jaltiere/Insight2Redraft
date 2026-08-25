# FE-3d: Admin Accounts & Grants — Design

Date: 2026-08-24
Track: Frontend admin area (FE-3), fourth slice. Follows FE-3a (shell/auth), FE-3b (seasons/leagues), FE-3c (owners/mapping).
Branch: `plan/fe-3d-accounts-grants`

## Goal

Give the super-admin a UI for the last unexposed account-management surface:
create and list League-Admin accounts, reset their passwords, delete them, and
grant/revoke per-league admin rights. This is the API-3c coverage owed by the
admin-UI backlog in [[admin-capabilities-need-ui]] — today it is reachable only
by hitting the API directly, which that note forbids for real users.

Two deliverables, in order:

1. **Backend cycle — `GET /admin/leagues`.** A flat league list the grant picker
   needs. Ships as its own PR so the frontend slice keeps the "no backend
   changes" rule every FE slice has held to.
2. **FE-3d — accounts & grants screens.**

## Roles

The entire section is **super-admin only**, backend-enforced: every route in
`app/api/admin/accounts.py` sits under `dependencies=[Depends(require_super_admin)]`,
as does `app/api/admin/leagues.py`. The UI mirrors this with the existing
`ProtectedRoute requireRole="super_admin"` block, and `adminSections.ts` already
hides the Accounts nav entry from league-admins.

## Backend contract

### Already shipped (`app/api/admin/accounts.py`)

- `GET /admin/accounts` → `AccountAdminResponse[]`, ordered by id. Returns **all**
  accounts, super-admins included.
- `POST /admin/accounts` — `AccountCreate { email, password, owner_id? }` → 201
  `AccountAdminResponse`. **Always creates role `league_admin`** (the role is not
  a request field). **409** duplicate email; **422** `"Owner does not exist"`.
- `PATCH /admin/accounts/{id}` — `AccountPasswordReset { password }` →
  `AccountAdminResponse`. Password reset **only**; no other field is editable. 404.
- `DELETE /admin/accounts/{id}` → 204. **409** `"Cannot delete the last super admin"`; 404.
- `POST /admin/accounts/{id}/grants` — `GrantCreate { league_id }` → 201
  `LeagueGrantRef`. **404** account or league; **422** `"Grants apply only to
  league admins"`; **409** `"Grant already exists"`.
- `DELETE /admin/accounts/{id}/grants/{league_id}` → 204; **404** `"Grant not found"`.

`AccountAdminResponse` = `{ id, email, role: AccountRole, owner_id: number|null,
grants: LeagueGrantRef[] }`. `LeagueGrantRef` = `{ league_id, league_name }`.

**Note there is no `GET /admin/accounts/{id}`.** The list already carries grants,
so the detail page reads its account out of the cached list rather than fetching
one (see Data flow).

### New in deliverable 1 (`app/api/admin/leagues.py`)

- `GET /admin/leagues` → `LeagueAdminRef[]` = `{ id, name, season_year }`, ordered
  by season year descending then league name. No pagination — the corpus is one
  handful of leagues per season.

It lands in the existing admin-leagues router, which is already wholly
`require_super_admin`, so it inherits the correct gating with no new dependency
wiring. Tests: one for the happy path (shape + ordering across two seasons), one
asserting a league-admin token gets 403.

## Screens

### `/admin/accounts` — list

Replaces the current `AdminSectionStub`. A table: email, role pill, grant count,
each row linking to the detail page. Grant count renders `—` for super-admins,
since grants apply only to league-admins. A `+ New account` button opens the
create dialog.

### `/admin/accounts/:id` — detail

Header with email, role pill, and the linked owner's name (resolved via the
existing `useOwner` hook when `owner_id` is set). Below it:

- **Leagues** — the account's grants, each with a Revoke action, plus
  `+ Grant league`. For a super-admin account the whole block is replaced with a
  line explaining grants apply only to league-admins (the backend 422s otherwise).
- **Actions** — Reset password, Delete account.

Invalid or unknown `:id` renders the shared `NotFound` with account wording,
matching how `OwnerDetailPage` and `MappingPage` handle a bad param.

### Dialogs

- **Create account** — email, owner (optional), password, confirm password.
  Create stays disabled until the email is non-empty, the passwords match, and
  the password is at least 12 characters — the same
  validation-disables-the-button pattern the season form adopted in PR #24.
  Surfaces 409 (duplicate email) and 422 (bad owner) inline.
- **Reset password** — password + confirm, same rule.
- **Grant league** — a searchable list from `GET /admin/leagues` showing name and
  season year. Leagues the account already holds are listed but disabled, so the
  409 is prevented rather than explained.
- **Delete account** — confirm dialog naming the email, mirroring
  `LeagueRowActions`' delete confirm. Surfaces the last-super-admin 409 inline.

## Component reuse and one refactor

The account form needs an owner selector, but **`OwnerPicker` cannot be reused
as-is**: it hardwires `useAssignTeamOwner(leagueId)` and calls the assign
mutation itself, so it only works inside the mapping worksheet.

Extract its search + inline-create combobox into `OwnerCombobox`, which takes an
`onSelect(owner: OwnerRef)` callback and owns no mutation. `OwnerPicker` becomes
that combobox plus the assign call; the account form uses the same combobox to
set `owner_id`. This keeps one owner-search behaviour rather than two
near-copies, and is confined to code this slice already touches.

Otherwise the slice reuses what exists: the radix `Dialog` primitive, `Button`,
`Input`, `Badge`, `RolePill`, `NotFound`, `isApiError`, and `@/test/renderWithAuth`.

## Data flow

- `useAccounts()` — `GET /admin/accounts`, key `["accounts"]`.
- `useAdminLeagues()` — `GET /admin/leagues`, key `["adminLeagues"]`, enabled only
  while the grant dialog is open.
- Mutations `useCreateAccount`, `useResetPassword`, `useDeleteAccount`,
  `useGrantLeague`, `useRevokeGrant` all invalidate `["accounts"]` on success.
  Because detail derives from the list, one invalidation refreshes both screens.
- The detail page finds its account with `accounts.find(a => a.id === id)`. While
  the list query is pending it shows the loading state; once resolved, a missing
  id renders `NotFound`.

## Error handling

Every mutation surfaces `ApiError.detail` inline in its dialog, never a toast —
consistent with FE-3b/3c. Specifically: 409 duplicate email, 422 owner does not
exist, 409 grant already exists, 409 cannot delete the last super admin, and 404
account/league/grant not found.

## Guards

- **Grant league** is hidden for super-admin accounts (the backend 422s).
- **Delete** is disabled on the signed-in super-admin's own account, read from
  `useAuth().account.id`, to prevent self-lockout. The backend's last-super-admin
  check does not cover deleting yourself while another super-admin exists.
- Already-granted leagues are disabled in the grant dialog.

## Testing

Vitest + RTL + MSW, `onUnhandledRequest: "error"`, using `@/test/renderWithAuth`
(default `/api/auth/me` is super_admin). New MSW handlers for the six account
endpoints plus `GET /admin/leagues`, including the 409 and 422 paths.

Coverage: list renders roles and grant counts; detail renders grants and the
linked owner; create surfaces the duplicate-email 409; password confirm mismatch
disables the button; grant adds a league and revoke removes it; delete surfaces
the last-super-admin 409; own-account delete is disabled; a league-admin hitting
`/admin/accounts` gets Not authorized.

Gate per task: `npm --prefix frontend run build`, `test`, `lint` all green;
backend cycle gated by `pytest` and its own lint.

## Non-goals

- **Editing an account's email, role, or owner** — the backend exposes none of
  these (`PATCH` takes only a password). Not a UI omission.
- **Creating super-admins** — `POST /admin/accounts` hardcodes `league_admin`.
- **Self-service password change** for the signed-in user; this is super-admin
  reset only.
- Bracket admin (FE-3e) and the FE-1 cosmetic cluster.

## Known limitations

- The **12-character minimum is frontend-only.** `AccountCreate.password` has no
  server-side validation, so the rule is advisory and a direct API call bypasses
  it. Acceptable because only super-admins reach this surface and
  [[admin-capabilities-need-ui]] establishes that real users go through the UI —
  but it is not an enforced policy, and a future backend cycle should add it.
- `GET /admin/accounts` exposes every account's email and grants to any
  super-admin. Inherent to the feature, recorded so it is a decision rather than
  an oversight.
- Deleting an account cascades its grants at the DB level; the UI does not warn
  how many grants are about to disappear. Low stakes — grants are re-issuable.
