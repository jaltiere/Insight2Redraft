# FE-3d: Admin Accounts & Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the super-admin a UI to create/list League-Admin accounts, reset passwords, delete accounts, and grant/revoke per-league admin rights — the last API-3c capability with no frontend surface.

**Architecture:** One small backend cycle adds `GET /admin/leagues` (the flat league list the grant picker needs). The frontend then adds an accounts list + detail page over a single `["accounts"]` query — the detail page derives its account from that cached list, because no per-account endpoint exists — plus four dialogs (create, reset password, grant, delete confirm). `OwnerPicker`'s combobox is extracted so the account form can reuse owner search.

**Tech Stack:** Backend: FastAPI, SQLAlchemy, pytest. Frontend: React 19, TS6, React Router v7, TanStack Query, Tailwind v4 (semantic tokens), radix-ui, Vitest + RTL + MSW.

**Spec:** `docs/superpowers/specs/2026-08-24-accounts-grants-design.md`

## Global Constraints

- Backend commands run from `backend/` (`pytest`, its lint). Frontend commands use `npm --prefix frontend <...>`. Gate per task: build + test + lint all green for whichever side the task touches.
- **The whole surface is super-admin only.** Backend routers already carry `dependencies=[Depends(require_super_admin)]`; the UI mirrors this via the existing `ProtectedRoute requireRole="super_admin"` block in `routes.tsx`. Do not add role props to these components.
- **Semantic tokens only** (light+dark): `bg-card`, `border`, `text-primary`, `text-muted-foreground`, `text-destructive`, `text-highlight`, `text-foreground`, `bg-muted`; the `Button`/`Input`/`Badge`/`Dialog`/`RolePill` primitives.
- **No new dependencies.**
- TypeScript 6: `import type`; `@/` alias only.
- **Every Dialog includes `DialogTitle` + `DialogDescription`** (radix a11y → pristine test output). **Dialogs reset their form state on OPEN** (FE-3b lesson).
- **All new frontend tests use `@/test/renderWithAuth`** (added in PR #24). Signature: `renderWithAuth(ui, { route?, token? })` → `{ ...renderResult, queryClient }`. Default token `"tok.123"` hydrates as **super_admin, account id 1, email `admin@example.com`**. Pass `token: null` for signed-out.
- MSW runs with `onUnhandledRequest: "error"` — Task 2 adds every handler this slice needs.
- **Password minimum is 12 characters, frontend-only** (the backend does not validate it). Same "validation disables the button" pattern the season form adopted in PR #24.
- **Commit hygiene:** the working tree has unrelated `.claude/*` vexp noise + `.superpowers/` scratch. Every commit stages ONLY its named files — never `git add -A`.

---

### Task 1: Backend — `GET /admin/leagues`

**Files:**
- Modify: `backend/app/api/admin/schemas.py`
- Modify: `backend/app/api/admin/leagues.py`
- Test: `backend/tests/api/admin/test_leagues.py` (append)

**Interfaces:**
- Produces: `GET /admin/leagues` → `LeagueAdminRef[]` where `LeagueAdminRef = { id: int, name: str, season_year: int }`, ordered by season year **descending**, then league name ascending. Task 2's `useAdminLeagues` consumes it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/admin/test_leagues.py`:

```python
def test_list_leagues_orders_newest_season_first(client, admin_headers, seed):
    older = seed.season(2023)
    newer = seed.season(2024)
    seed.league(newer, name="Redraft Kings")
    seed.league(newer, name="Dynasty League")
    seed.league(older, name="Keeper Classic")

    resp = client.get("/admin/leagues", headers=admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert [(r["name"], r["season_year"]) for r in body] == [
        ("Dynasty League", 2024),
        ("Redraft Kings", 2024),
        ("Keeper Classic", 2023),
    ]
    assert set(body[0]) == {"id", "name", "season_year"}


def test_list_leagues_forbidden_for_league_admin(client, make_account):
    resp = client.get("/admin/leagues", headers=_la_headers(make_account))
    assert resp.status_code == 403


def test_list_leagues_requires_token(client):
    assert client.get("/admin/leagues").status_code == 401
```

Note: `_la_headers` and the `seed` / `admin_headers` fixtures already exist in this file and `tests/api/conftest.py`. If `_la_headers` is not already defined in this file, copy it from `backend/tests/api/admin/test_accounts.py`.

- [ ] **Step 2: Run them — expect FAIL**

Run: `cd backend && pytest tests/api/admin/test_leagues.py -k list_leagues -v`
Expected: FAIL — 404, because the route does not exist.

- [ ] **Step 3: Add the response schema**

In `backend/app/api/admin/schemas.py`, next to the other league schemas:

```python
class LeagueAdminRef(BaseModel):
    id: int
    name: str
    season_year: int
```

- [ ] **Step 4: Add the route**

In `backend/app/api/admin/leagues.py`, add `LeagueAdminRef` to the existing
`from app.api.admin.schemas import (...)` block, and add this route (place it
above the `POST` routes so the read sits first):

```python
@router.get("/leagues", response_model=list[LeagueAdminRef])
def list_leagues(db: Session = Depends(get_db)) -> list[LeagueAdminRef]:
    rows = db.execute(
        select(League.id, League.name, Season.year)
        .join(Season, League.season_id == Season.id)
        .order_by(Season.year.desc(), League.name)
    ).all()
    return [
        LeagueAdminRef(id=lid, name=name, season_year=year)
        for lid, name, year in rows
    ]
```

`League`, `Season`, `select`, `Session`, `Depends` and `get_db` are already imported in this module.

- [ ] **Step 5: Run the tests — expect PASS**

Run: `cd backend && pytest tests/api/admin/test_leagues.py -v`, then the full `cd backend && pytest`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/admin/schemas.py backend/app/api/admin/leagues.py backend/tests/api/admin/test_leagues.py
git commit -m "feat(api): GET /admin/leagues flat league list for the grants UI"
```

---

### Task 2: Frontend foundation — types, hooks, MSW handlers

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/features/adminAccounts.ts`
- Modify: `frontend/src/test/handlers.ts`
- Test: `frontend/src/features/adminAccounts.test.tsx`

**Interfaces:**
- Produces (types): `LeagueGrantRef { league_id: number; league_name: string }`, `AccountAdminResponse { id: number; email: string; role: AccountRole; owner_id: number | null; grants: LeagueGrantRef[] }`, `AccountCreateBody { email: string; password: string; owner_id: number | null }`, `LeagueAdminRef { id: number; name: string; season_year: number }`.
- Produces (hooks): `useAccounts()`, `useAdminLeagues(enabled: boolean)`, `useCreateAccount()`, `useResetPassword(accountId: number)`, `useDeleteAccount()`, `useGrantLeague(accountId: number)`, `useRevokeGrant(accountId: number)`. Tasks 4–6 consume these.

- [ ] **Step 1: Add the types**

Append to `frontend/src/types/api.ts`:

```ts
export interface LeagueGrantRef {
  league_id: number;
  league_name: string;
}

export interface AccountAdminResponse {
  id: number;
  email: string;
  role: AccountRole;
  owner_id: number | null;
  grants: LeagueGrantRef[];
}

export interface AccountCreateBody {
  email: string;
  password: string;
  owner_id: number | null;
}

export interface LeagueAdminRef {
  id: number;
  name: string;
  season_year: number;
}
```

- [ ] **Step 2: Write the failing hook test**

Create `frontend/src/features/adminAccounts.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useAccounts, useAdminLeagues } from "./adminAccounts";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test("useAccounts returns accounts with their grants", async () => {
  const { result } = renderHook(() => useAccounts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const maria = result.current.data?.find((a) => a.email === "maria@ex.com");
  expect(maria?.role).toBe("league_admin");
  expect(maria?.grants).toEqual([{ league_id: 3, league_name: "Dynasty League" }]);
});

test("useAdminLeagues stays idle until enabled", async () => {
  const { result } = renderHook(() => useAdminLeagues(false), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
});

test("useAdminLeagues loads leagues newest season first when enabled", async () => {
  const { result } = renderHook(() => useAdminLeagues(true), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map((l) => l.name)).toEqual([
    "Dynasty League",
    "Redraft Kings",
    "Keeper Classic",
  ]);
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/features/adminAccounts.test.tsx`
Expected: FAIL — cannot resolve `./adminAccounts`.

- [ ] **Step 4: Add the MSW handlers**

In `frontend/src/test/handlers.ts`, add before the closing `];`:

```ts
  // --- admin: accounts & grants (FE-3d) ---
  http.get("/api/admin/accounts", () =>
    HttpResponse.json([
      { id: 1, email: "admin@example.com", role: "super_admin", owner_id: null, grants: [] },
      {
        id: 2, email: "maria@ex.com", role: "league_admin", owner_id: 2,
        grants: [{ league_id: 3, league_name: "Dynasty League" }],
      },
      { id: 3, email: "sam@ex.com", role: "league_admin", owner_id: null, grants: [] },
    ]),
  ),
  http.post("/api/admin/accounts", async ({ request }) => {
    const b = (await request.json()) as { email: string; owner_id: number | null };
    if (b.email === "dupe@ex.com") {
      return HttpResponse.json({ detail: "Account email already exists" }, { status: 409 });
    }
    if (b.owner_id === 999) {
      return HttpResponse.json({ detail: "Owner does not exist" }, { status: 422 });
    }
    return HttpResponse.json(
      { id: 9, email: b.email, role: "league_admin", owner_id: b.owner_id, grants: [] },
      { status: 201 },
    );
  }),
  http.patch("/api/admin/accounts/:id", ({ params }) =>
    HttpResponse.json({
      id: Number(params.id), email: "maria@ex.com", role: "league_admin",
      owner_id: 2, grants: [{ league_id: 3, league_name: "Dynasty League" }],
    }),
  ),
  http.delete("/api/admin/accounts/:id", ({ params }) => {
    if (params.id === "1") {
      return HttpResponse.json({ detail: "Cannot delete the last super admin" }, { status: 409 });
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("/api/admin/accounts/:id/grants", async ({ request }) => {
    const b = (await request.json()) as { league_id: number };
    if (b.league_id === 3) {
      return HttpResponse.json({ detail: "Grant already exists" }, { status: 409 });
    }
    return HttpResponse.json(
      { league_id: b.league_id, league_name: "Redraft Kings" },
      { status: 201 },
    );
  }),
  http.delete("/api/admin/accounts/:id/grants/:leagueId", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/admin/leagues", () =>
    HttpResponse.json([
      { id: 3, name: "Dynasty League", season_year: 2024 },
      { id: 4, name: "Redraft Kings", season_year: 2024 },
      { id: 5, name: "Keeper Classic", season_year: 2023 },
    ]),
  ),
```

- [ ] **Step 5: Create the hooks**

Create `frontend/src/features/adminAccounts.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  AccountAdminResponse, AccountCreateBody, LeagueAdminRef, LeagueGrantRef,
} from "@/types/api";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiClient.get<AccountAdminResponse[]>("/admin/accounts"),
  });
}

/** Only fetched while the grant dialog is open. */
export function useAdminLeagues(enabled: boolean) {
  return useQuery({
    queryKey: ["adminLeagues"],
    queryFn: () => apiClient.get<LeagueAdminRef[]>("/admin/leagues"),
    enabled,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AccountCreateBody) =>
      apiClient.post<AccountAdminResponse>("/admin/accounts", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useResetPassword(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiClient.patch<AccountAdminResponse>(`/admin/accounts/${accountId}`, { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => apiClient.delete<void>(`/admin/accounts/${accountId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useGrantLeague(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.post<LeagueGrantRef>(`/admin/accounts/${accountId}/grants`, { league_id: leagueId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useRevokeGrant(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.delete<void>(`/admin/accounts/${accountId}/grants/${leagueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}
```

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/features/adminAccounts.test.tsx` (expect PASS), then full `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run lint` — all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/features/adminAccounts.ts frontend/src/features/adminAccounts.test.tsx frontend/src/test/handlers.ts
git commit -m "feat(frontend): FE-3d foundation — account/grant types, hooks, MSW handlers"
```

---

### Task 3: Extract `OwnerCombobox` from `OwnerPicker`

**Files:**
- Create: `frontend/src/pages/admin/OwnerCombobox.tsx`
- Modify: `frontend/src/pages/admin/OwnerPicker.tsx`
- Test: `frontend/src/pages/admin/OwnerCombobox.test.tsx`

**Interfaces:**
- Produces: `OwnerCombobox` with props `{ sleeperName?: string | null; onSelect: (owner: OwnerAdminResponse) => void | Promise<void>; onCancel: () => void }`. It renders the search input, the result list, the inline-create shortcut, and a Cancel button. It owns **no** mutation. Task 4's account form consumes it.
- `OwnerPicker` keeps its existing public props `{ leagueId, teamId, sleeperName, current }` — its callers (`MappingPage`) must not change.

**Why:** `OwnerPicker` hardwires `useAssignTeamOwner(leagueId)`, so it only works inside the mapping worksheet. The account form needs the same search + inline-create with a different action.

- [ ] **Step 1: Write the failing combobox test**

Create `frontend/src/pages/admin/OwnerCombobox.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { OwnerCombobox } from "./OwnerCombobox";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

test("searching and picking an owner calls onSelect with that owner", async () => {
  const onSelect = vi.fn();
  renderWithAuth(<OwnerCombobox onSelect={onSelect} onCancel={() => {}} />);

  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  await userEvent.click(await screen.findByRole("button", { name: /Maria Pappas/ }));

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 2, last_name: "Pappas" });
});

test("Cancel calls onCancel", async () => {
  const onCancel = vi.fn();
  renderWithAuth(<OwnerCombobox onSelect={() => {}} onCancel={onCancel} />);
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/OwnerCombobox.test.tsx`
Expected: FAIL — cannot resolve `./OwnerCombobox`.

- [ ] **Step 3: Create the combobox**

Create `frontend/src/pages/admin/OwnerCombobox.tsx` — this is `OwnerPicker`'s open-state body with the assign call replaced by `onSelect`:

```tsx
import { useState } from "react";
import { useOwners } from "@/features/adminOwners";
import { useDebounced } from "@/lib/useDebounced";
import { ownerName } from "@/features/standings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";
import type { OwnerAdminResponse } from "@/types/api";

export function OwnerCombobox({
  sleeperName, onSelect, onCancel,
}: {
  sleeperName?: string | null;
  onSelect: (owner: OwnerAdminResponse) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text, 250);
  const results = useOwners(q, true);

  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={text}
        placeholder="Search owners…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="rounded-md border bg-card">
        {results.data?.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => void onSelect(o)}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {ownerName(o)}
            {o.email ? <span className="text-muted-foreground"> · {o.email}</span> : null}
          </button>
        ))}
        <OwnerFormDialog
          mode="create"
          prefillFirstName={sleeperName ?? ""}
          onCreated={(o) => void onSelect(o)}
          trigger={
            <button
              type="button"
              className="block w-full px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted"
            >
              ＋ Create {sleeperName ? `"${sleeperName}"` : "new owner"}
            </button>
          }
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `OwnerPicker` to use it**

Replace the whole body of `frontend/src/pages/admin/OwnerPicker.tsx` with:

```tsx
import { useState } from "react";
import { useAssignTeamOwner } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { OwnerCombobox } from "./OwnerCombobox";
import type { OwnerRef } from "@/types/api";

export function OwnerPicker({
  leagueId, teamId, sleeperName, current,
}: {
  leagueId: number; teamId: number; sleeperName: string | null; current: OwnerRef | null;
}) {
  const [open, setOpen] = useState(false);
  const [assigned, setAssigned] = useState<OwnerRef | null>(current);
  const [error, setError] = useState<string | null>(null);
  const assign = useAssignTeamOwner(leagueId);

  async function pick(ownerId: number) {
    setError(null);
    try {
      const row = await assign.mutateAsync({ teamId, ownerId });
      setAssigned(row.owner);
      setOpen(false);
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
        <Button variant="link" size="sm" onClick={() => setOpen(true)}>
          {assigned ? "change" : "assign"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <OwnerCombobox
        sleeperName={sleeperName}
        onSelect={(o) => pick(o.id)}
        onCancel={() => setOpen(false)}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 5: Run the affected tests — expect PASS with no changes to them**

Run: `npm --prefix frontend test -- src/pages/admin/OwnerCombobox.test.tsx src/pages/admin/OwnerPicker.test.tsx src/pages/admin/MappingPage.test.tsx`

All must pass **without editing `OwnerPicker.test.tsx` or `MappingPage.test.tsx`** — that is the proof the refactor preserved behaviour. If either needs editing, the extraction changed behaviour: stop and fix the component, not the test.

- [ ] **Step 6: Gate + commit**

Run full `npm --prefix frontend test`, build, lint — green.

```bash
git add frontend/src/pages/admin/OwnerCombobox.tsx frontend/src/pages/admin/OwnerCombobox.test.tsx frontend/src/pages/admin/OwnerPicker.tsx
git commit -m "refactor(frontend): extract OwnerCombobox from OwnerPicker"
```

---

### Task 4: Accounts list page + create dialog + route

**Files:**
- Create: `frontend/src/pages/admin/AccountsListPage.tsx`
- Create: `frontend/src/pages/admin/AccountFormDialog.tsx`
- Test: `frontend/src/pages/admin/AccountsListPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `useCreateAccount` (Task 2); `OwnerCombobox` (Task 3); `RolePill`, `Button`, `Input`, `Dialog` primitives.
- Produces: `AccountsListPage`; `AccountFormDialog` with props `{ trigger: ReactNode }` (create-only — the backend exposes no account edit); route `/admin/accounts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AccountsListPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { AccountsListPage } from "./AccountsListPage";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

test("lists accounts with roles and grant counts", async () => {
  renderWithAuth(<AccountsListPage />);
  expect(await screen.findByRole("link", { name: /maria@ex.com/ })).toHaveAttribute(
    "href", "/admin/accounts/2",
  );
  expect(screen.getByText("Super-admin")).toBeInTheDocument();
  expect(screen.getAllByText("League-admin")).toHaveLength(2);
  expect(screen.getByText("1 league")).toBeInTheDocument();   // maria
  expect(screen.getByText("0 leagues")).toBeInTheDocument();  // sam
  expect(screen.getByText("—")).toBeInTheDocument();          // super-admin: grants N/A
});

test("Create stays disabled until email and matching 12-char passwords are entered", async () => {
  renderWithAuth(<AccountsListPage />);
  await userEvent.click(await screen.findByRole("button", { name: /new account/i }));

  const create = screen.getByRole("button", { name: /^create$/i });
  expect(create).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/email/i), "new@ex.com");
  await userEvent.type(screen.getByLabelText(/^password$/i), "short");
  await userEvent.type(screen.getByLabelText(/confirm/i), "short");
  expect(create).toBeDisabled();
  expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText(/^password$/i));
  await userEvent.clear(screen.getByLabelText(/confirm/i));
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw124");
  expect(create).toBeDisabled();
  expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText(/confirm/i));
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  expect(create).toBeEnabled();
});

test("a duplicate email surfaces the 409 inline", async () => {
  renderWithAuth(<AccountsListPage />);
  await userEvent.click(await screen.findByRole("button", { name: /new account/i }));
  await userEvent.type(screen.getByLabelText(/email/i), "dupe@ex.com");
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

  expect(await screen.findByText(/account email already exists/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/AccountsListPage.test.tsx`

- [ ] **Step 3: Create the account form dialog**

Create `frontend/src/pages/admin/AccountFormDialog.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateAccount } from "@/features/adminAccounts";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { OwnerCombobox } from "./OwnerCombobox";
import type { OwnerAdminResponse } from "@/types/api";

const MIN_PASSWORD = 12;

/** First problem with the form, or null when it is submittable. */
function formError(email: string, password: string, confirm: string): string | null {
  if (email.trim() === "") return "Email is required.";
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

export function AccountFormDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [owner, setOwner] = useState<OwnerAdminResponse | null>(null);
  const [pickingOwner, setPickingOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAccount();
  const invalid = formError(email, password, confirm);

  function reset() {
    setEmail(""); setPassword(""); setConfirm("");
    setOwner(null); setPickingOwner(false); setError(null);
  }

  async function onSubmit() {
    setError(null);
    try {
      await create.mutateAsync({ email, password, owner_id: owner?.id ?? null });
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Create failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Creates a league-admin account. Grant it leagues from the account's page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Owner</span>
            {pickingOwner ? (
              <OwnerCombobox
                onSelect={(o) => { setOwner(o); setPickingOwner(false); }}
                onCancel={() => setPickingOwner(false)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className={owner ? "text-foreground" : "text-muted-foreground"}>
                  {owner ? ownerName(owner) : "Not linked"}
                </span>
                <Button variant="link" size="sm" onClick={() => setPickingOwner(true)}>
                  {owner ? "change" : "link owner"}
                </Button>
              </div>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Password</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Confirm password</span>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {invalid && <p className="text-sm text-muted-foreground">{invalid}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={create.isPending || invalid !== null}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `<Input type="password">` with a `<label>` wrapper gives each field an accessible name, which is what `getByLabelText(/^password$/i)` and `/confirm/i` match.

- [ ] **Step 4: Create the list page**

Create `frontend/src/pages/admin/AccountsListPage.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAccounts } from "@/features/adminAccounts";
import { RolePill } from "@/components/RolePill";
import { Button } from "@/components/ui/button";
import { AccountFormDialog } from "./AccountFormDialog";
import type { AccountAdminResponse } from "@/types/api";

function grantLabel(a: AccountAdminResponse): string {
  if (a.role === "super_admin") return "—";
  return a.grants.length === 1 ? "1 league" : `${a.grants.length} leagues`;
}

export function AccountsListPage() {
  const accounts = useAccounts();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <AccountFormDialog trigger={<Button>New account</Button>} />
      </div>
      {accounts.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : accounts.isError ? (
        <p className="text-destructive">Couldn't load accounts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.data.map((a) => (
            <li key={a.id}>
              <Link
                to={`/admin/accounts/${a.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary"
              >
                <span className="font-medium">{a.email}</span>
                <span className="flex items-center gap-3">
                  <RolePill role={a.role} />
                  <span className="text-sm text-muted-foreground">{grantLabel(a)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route**

In `frontend/src/routes.tsx`: import `AccountsListPage`, and **replace** the existing
`{ path: "accounts", element: <AdminSectionStub title="Accounts" /> }` inside the
`<ProtectedRoute requireRole="super_admin" />` children with:

```tsx
{ path: "accounts", element: <AccountsListPage /> },
```

Leave the `AdminSectionStub` import in place only if another route still uses it; if
nothing else references it, remove the now-unused import so lint stays clean.

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/AccountsListPage.test.tsx src/pages/admin/admin-routes.test.tsx`, then full test, build, lint — green.

`admin-routes.test.tsx` asserts a league-admin hitting `/admin/accounts` sees "Not authorized"; it must still pass, proving the route stayed super-admin gated.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/AccountsListPage.tsx frontend/src/pages/admin/AccountFormDialog.tsx frontend/src/pages/admin/AccountsListPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3d accounts list + create-account dialog"
```

---

### Task 5: Account detail page + reset password + delete + route

**Files:**
- Create: `frontend/src/pages/admin/AccountDetailPage.tsx`
- Create: `frontend/src/pages/admin/ResetPasswordDialog.tsx`
- Test: `frontend/src/pages/admin/AccountDetailPage.test.tsx`
- Modify: `frontend/src/routes.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `useResetPassword`, `useDeleteAccount` (Task 2); `useOwner` (`@/features/adminOwners`); `useAuth`; `RolePill`; `NotFound`.
- Produces: `AccountDetailPage`; `ResetPasswordDialog` with props `{ accountId: number; trigger: ReactNode }`; route `/admin/accounts/:id`.
- The grants block is added in Task 6 — this task renders the account header and the two destructive actions only.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AccountDetailPage.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AccountDetailPage } from "./AccountDetailPage";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/accounts/2") {
  return renderWithAuth(
    <Routes><Route path="/admin/accounts/:id" element={<AccountDetailPage />} /></Routes>,
    { route: path },
  );
}

test("renders the account header with its role", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: "maria@ex.com" })).toBeInTheDocument();
  expect(screen.getByText("League-admin")).toBeInTheDocument();
});

test("an unknown account id renders not-found", async () => {
  renderAt("/admin/accounts/777");
  expect(await screen.findByText(/account not found/i)).toBeInTheDocument();
});

test("a non-numeric id renders not-found", async () => {
  renderAt("/admin/accounts/abc");
  expect(await screen.findByText(/account not found/i)).toBeInTheDocument();
});

test("reset password requires a matching 12-char password", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /reset password/i }));

  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  expect(save).toBeEnabled();
});

test("deleting your own account is blocked", async () => {
  // the signed-in test account is id 1
  renderAt("/admin/accounts/1");
  await screen.findByRole("heading", { name: "admin@example.com" });
  expect(screen.getByRole("button", { name: /delete account/i })).toBeDisabled();
  expect(screen.getByText(/you can't delete the account you're signed in with/i)).toBeInTheDocument();
});

test("deleting another account confirms and closes without error", async () => {
  renderAt("/admin/accounts/3");
  await screen.findByRole("heading", { name: "sam@ex.com" });
  await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
  await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
  // MSW deletes id 3 successfully; the dialog closes and nothing is announced
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/AccountDetailPage.test.tsx`

- [ ] **Step 3: Create the reset-password dialog**

Create `frontend/src/pages/admin/ResetPasswordDialog.tsx`:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { useResetPassword } from "@/features/adminAccounts";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const MIN_PASSWORD = 12;

export function ResetPasswordDialog({
  accountId, trigger,
}: {
  accountId: number; trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reset = useResetPassword(accountId);

  const invalid =
    password.length < MIN_PASSWORD
      ? `Password must be at least ${MIN_PASSWORD} characters.`
      : password !== confirm
        ? "Passwords do not match."
        : null;

  async function onSubmit() {
    setError(null);
    try {
      await reset.mutateAsync(password);
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Reset failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setPassword(""); setConfirm(""); setError(null); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Sets a new password for this account. Tell the account holder out of band.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Password</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Confirm password</span>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {invalid && <p className="text-sm text-muted-foreground">{invalid}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={reset.isPending || invalid !== null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create the detail page**

Create `frontend/src/pages/admin/AccountDetailPage.tsx`:

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAccounts, useDeleteAccount } from "@/features/adminAccounts";
import { useOwner } from "@/features/adminOwners";
import { useAuth } from "@/auth/useAuth";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { RolePill } from "@/components/RolePill";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

export function AccountDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const navigate = useNavigate();
  const { account: me } = useAuth();

  const accounts = useAccounts();
  const account = valid ? accounts.data?.find((a) => a.id === id) : undefined;

  const del = useDeleteAccount();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // hooks must run unconditionally; useOwner no-ops on null
  const owner = useOwner(account?.owner_id ?? null);

  if (!valid) return <NotFound title="Account not found" message="We couldn't find that account." />;
  if (accounts.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (accounts.isError) return <p className="text-destructive">Couldn't load accounts.</p>;
  if (!account) return <NotFound title="Account not found" message="We couldn't find that account." />;

  const isSelf = me?.id === account.id;

  async function onDelete() {
    setDeleteError(null);
    try {
      await del.mutateAsync(id);
      setConfirmOpen(false);
      navigate("/admin/accounts");
    } catch (e) {
      setDeleteError(isApiError(e) ? e.detail : "Delete failed");
    }
  }

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{account.email}</h1>
        <RolePill role={account.role} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Owner: {account.owner_id === null ? "not linked" : owner.data ? ownerName(owner.data) : "…"}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <ResetPasswordDialog
          accountId={account.id}
          trigger={<Button variant="outline">Reset password</Button>}
        />
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => { setConfirmOpen(o); setDeleteError(null); }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={isSelf}>Delete account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {account.email}?</DialogTitle>
              <DialogDescription>
                This removes the account and every league grant it holds.
              </DialogDescription>
            </DialogHeader>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isSelf && (
        <p className="mt-2 text-sm text-muted-foreground">
          You can't delete the account you're signed in with.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route**

In `frontend/src/routes.tsx`, import `AccountDetailPage` and add it beside the accounts
route, **inside the same `<ProtectedRoute requireRole="super_admin" />` children array**:

```tsx
{ path: "accounts/:id", element: <AccountDetailPage /> },
```

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/AccountDetailPage.test.tsx`, then full test, build, lint — green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/AccountDetailPage.tsx frontend/src/pages/admin/ResetPasswordDialog.tsx frontend/src/pages/admin/AccountDetailPage.test.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): FE-3d account detail + reset password + delete"
```

---

### Task 6: Grants — grant dialog + revoke on the detail page

**Files:**
- Create: `frontend/src/pages/admin/GrantLeagueDialog.tsx`
- Modify: `frontend/src/pages/admin/AccountDetailPage.tsx`
- Test: `frontend/src/pages/admin/AccountGrants.test.tsx`

**Interfaces:**
- Consumes: `useAdminLeagues`, `useGrantLeague`, `useRevokeGrant` (Task 2); `AccountAdminResponse`, `LeagueGrantRef` types.
- Produces: `GrantLeagueDialog` with props `{ accountId: number; existing: LeagueGrantRef[] }` — it renders its own "Grant league" trigger button.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AccountGrants.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AccountDetailPage } from "./AccountDetailPage";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/accounts/2") {
  return renderWithAuth(
    <Routes><Route path="/admin/accounts/:id" element={<AccountDetailPage />} /></Routes>,
    { route: path },
  );
}

test("lists the account's granted leagues with a revoke action", async () => {
  renderAt();
  const grants = await screen.findByRole("list", { name: /granted leagues/i });
  expect(within(grants).getByText("Dynasty League")).toBeInTheDocument();
  expect(within(grants).getByRole("button", { name: /revoke/i })).toBeInTheDocument();
});

test("an account with no grants says so", async () => {
  renderAt("/admin/accounts/3");
  expect(await screen.findByText(/no leagues granted yet/i)).toBeInTheDocument();
});

test("the grant dialog disables leagues the account already holds", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /grant league/i }));
  expect(await screen.findByRole("button", { name: /Redraft Kings/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /Dynasty League/ })).toBeDisabled();
});

test("granting a league closes the dialog", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /grant league/i }));
  await userEvent.click(await screen.findByRole("button", { name: /Redraft Kings/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a super-admin account shows no grants block", async () => {
  renderAt("/admin/accounts/1");
  await screen.findByRole("heading", { name: "admin@example.com" });
  expect(screen.queryByRole("button", { name: /grant league/i })).toBeNull();
  expect(screen.getByText(/grants apply only to league-admin accounts/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/AccountGrants.test.tsx`

- [ ] **Step 3: Create the grant dialog**

Create `frontend/src/pages/admin/GrantLeagueDialog.tsx`:

```tsx
import { useState } from "react";
import { useAdminLeagues, useGrantLeague } from "@/features/adminAccounts";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { LeagueGrantRef } from "@/types/api";

export function GrantLeagueDialog({
  accountId, existing,
}: {
  accountId: number; existing: LeagueGrantRef[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const leagues = useAdminLeagues(open);
  const grant = useGrantLeague(accountId);

  const held = new Set(existing.map((g) => g.league_id));
  const term = q.trim().toLowerCase();
  const rows = (leagues.data ?? []).filter(
    (l) => term === "" || l.name.toLowerCase().includes(term) || String(l.season_year).includes(term),
  );

  async function pick(leagueId: number) {
    setError(null);
    try {
      await grant.mutateAsync(leagueId);
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Grant failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) { setQ(""); setError(null); } }}
    >
      <DialogTrigger asChild><Button variant="outline" size="sm">Grant league</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant a league</DialogTitle>
          <DialogDescription>
            Gives this account admin rights on one league. Leagues it already holds are disabled.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          placeholder="Search leagues…"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-64 overflow-y-auto rounded-md border bg-card">
          {leagues.isPending ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No leagues match.</p>
          ) : (
            rows.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={held.has(l.id) || grant.isPending}
                onClick={() => pick(l.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span>{l.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {l.season_year}{held.has(l.id) ? " · granted" : ""}
                </span>
              </button>
            ))
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add the grants block to the detail page**

In `frontend/src/pages/admin/AccountDetailPage.tsx`:

Add the imports:

```tsx
import { useRevokeGrant } from "@/features/adminAccounts";
import { GrantLeagueDialog } from "./GrantLeagueDialog";
```

Add the hook next to the others (before the early returns):

```tsx
  const revoke = useRevokeGrant(valid ? id : 0);
```

Then insert this block between the `Owner:` paragraph and the actions row:

```tsx
      <h2 className="mb-2 text-lg font-semibold">Leagues</h2>
      {account.role === "super_admin" ? (
        <p className="mb-6 text-sm text-muted-foreground">
          Grants apply only to league-admin accounts — a super-admin already has every league.
        </p>
      ) : (
        <div className="mb-6 flex flex-col items-start gap-2">
          {account.grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leagues granted yet.</p>
          ) : (
            <ul aria-label="Granted leagues" className="flex w-full flex-col gap-1">
              {account.grants.map((g) => (
                <li
                  key={g.league_id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span>{g.league_name}</span>
                  <Button
                    variant="link"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(g.league_id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <GrantLeagueDialog accountId={account.id} existing={account.grants} />
        </div>
      )}
```

- [ ] **Step 5: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/AccountGrants.test.tsx src/pages/admin/AccountDetailPage.test.tsx`, then full test, build, lint — green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/GrantLeagueDialog.tsx frontend/src/pages/admin/AccountGrants.test.tsx frontend/src/pages/admin/AccountDetailPage.tsx
git commit -m "feat(frontend): FE-3d league grant + revoke on the account page"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`API_PROXY_TARGET=http://localhost:8123 npm --prefix frontend run dev`) against a seeded backend: create an account, link an owner, reset its password, grant and revoke a league, and confirm delete is disabled on your own account — in light + dark, and at a narrow width to exercise the collapsed rail from PR #24. This gate is **still owed for FE-3c too** — do both in one pass.
- **PRs:** Task 1 ships as its own backend PR; Tasks 2–6 as the FE-3d PR. Both per [[git-workflow]]. No sensitive data.

## Self-review notes (author check)

- **Spec coverage:** backend `GET /admin/leagues` (T1); types/hooks/handlers (T2); the `OwnerCombobox` extraction the spec calls for (T3); list + create dialog + route (T4); detail + reset + delete + self-lockout guard + route (T5); grant dialog with already-held disabled, revoke, and the super-admin no-grants case (T6). Error surfaces: 409 dup email (T4), 409 last-super-admin and 404 (T5), 409 dup grant prevented by disabling (T6).
- **Type consistency:** `AccountAdminResponse`/`LeagueGrantRef`/`AccountCreateBody`/`LeagueAdminRef` defined in T2 and used unchanged in T4–T6. Hook names match across tasks. `OwnerCombobox` props `{sleeperName?, onSelect, onCancel}` are identical in T3's definition and T4's use. `RolePill` takes `AccountRole | null` — passing `account.role` is in range.
- **Deliberate non-goals** (from the spec): no account email/role/owner editing, no super-admin creation, no self-service password change — the backend exposes none of them.
- **Known limitation carried from the spec:** the 12-character minimum is frontend-only; a direct API call bypasses it.
