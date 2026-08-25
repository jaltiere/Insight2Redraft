# FE-3e: Bracket Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the super-admin a UI to generate, review, approve, and finalize the site's super-bracket — the last admin endpoints with no frontend surface.

**Architecture:** One backend cycle enriches the admin bracket response so a draft shows real team names (today it returns bare integer IDs and the rich public endpoint hides pending brackets). The frontend then adds one season-scoped page at `/admin/seasons/:id/bracket` that branches on four states (no-bracket / pending / active / complete), plus a **presentational** `BracketRounds` component built for FE-2 to reuse.

**Tech Stack:** Backend: FastAPI, SQLAlchemy, pytest. Frontend: React 19, TS6, React Router v7, TanStack Query, Tailwind v4 (semantic tokens), radix-ui, Vitest + RTL + MSW.

**Spec:** `docs/superpowers/specs/2026-08-25-bracket-admin-design.md`

## Global Constraints

- Backend commands run from `backend/` (use `.venv/bin/pytest`; plain `python`/`pytest` may not be on PATH). Frontend commands use `npm --prefix frontend <...>`. Gate per task: build + test + lint green for whichever side the task touches.
- **The backend test suite is entirely DB-backed and needs Postgres on `localhost:5432`.** If it is down, every test errors with `psycopg.OperationalError: connection refused` — that is environmental, not your change. Check with `ss -ltn | grep 5432` before believing a failure, and report it rather than trying to fix it.
- **The whole bracket surface is super-admin only.** `app/api/admin/bracket.py` already declares `dependencies=[Depends(require_super_admin)]` on its router; the UI route goes inside the existing `<ProtectedRoute requireRole="super_admin" />` block in `frontend/src/routes.tsx`. Do not add role props to these components.
- **Semantic tokens only** (light+dark): `bg-card`, `border`, `text-primary`, `text-muted-foreground`, `text-destructive`, `text-highlight`, `text-foreground`, `bg-muted`; the `Button`/`Input`/`Badge`/`Dialog` primitives.
- **No new dependencies.**
- TypeScript 6: `import type`; `@/` alias only.
- **Every Dialog includes `DialogTitle` + `DialogDescription`**, and resets its state on OPEN.
- **All new frontend tests use `@/test/renderWithAuth`** — `renderWithAuth(ui, { route?, token? })` → `{ ...renderResult, queryClient }`. Default token hydrates as super_admin (account id 1).
- MSW runs with `onUnhandledRequest: "error"` — Task 2 adds every handler this slice needs.
- **Commit hygiene:** the working tree carries unrelated `.claude/*` modifications, an untracked `.superpowers/` directory that is NOT git-ignored, and an untracked `backend/insight2redraft_backend.egg-info/`. Every commit stages ONLY its named files — never `git add -A`.

---

### Task 1: Backend — enrich the admin bracket response

**Files:**
- Modify: `backend/app/api/admin/schemas.py`
- Modify: `backend/app/api/admin/bracket.py`
- Test: `backend/tests/api/admin/test_bracket.py` (append)

**Interfaces:**
- Produces: `GET/POST /admin/seasons/{id}/bracket*` now return `BracketSeedAdmin { seed, team_id, qualified_via, league_name, owner }` and `BracketMatchupAdmin { id, round, nfl_week, team_a, team_b, team_a_score, team_b_score, winner_team_id, is_finalized, bye }` where `team_a`/`team_b` are `BracketTeamRef | None`. Task 2's TypeScript types mirror this exactly.

**Why:** the admin response returns bare integers, so a draft-review screen would show "Team 47 vs Team 12". The public endpoint resolves names already but serves only ACTIVE/COMPLETE brackets (`app/api/bracket.py`, `_PUBLIC_STATUSES`), so a PENDING draft cannot use it.

**Note on the breaking change:** `team_a_id`/`team_b_id` are REPLACED by `team_a`/`team_b`. The endpoint has no consumers yet. The existing tests in `test_bracket.py` assert only `status`, `size`, `len(seeds)`, `bye`, and `round`, so none of them break — but do not assume; run them.

**Note on `model_validate`:** `BracketMatchup` has NO `team_a`/`team_b` relationships, only FK columns (`backend/app/models/bracket.py:74-75`). The current `BracketMatchupAdmin.model_validate(m)` will NOT resolve the new nested fields. You must construct the responses explicitly, as `app/api/bracket.py` does.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/admin/test_bracket.py`:

```python
def test_generated_bracket_resolves_team_names_and_owners(
    client, admin_headers, db_session, seed
):
    # a generated bracket must be reviewable by a human: seeds and matchups
    # carry league names and owners, not bare ids
    resp = _generate(client, admin_headers, db_session, seed)

    assert resp.status_code == 201
    body = resp.json()

    first_seed = body["seeds"][0]
    assert set(first_seed) == {"seed", "team_id", "qualified_via", "league_name", "owner"}
    assert isinstance(first_seed["league_name"], str) and first_seed["league_name"]

    played = [m for m in body["matchups"] if not m["bye"]]
    assert played, "expected at least one non-bye matchup"
    ref = played[0]["team_a"]
    assert set(ref) == {"team_id", "seed", "league_name", "owner"}
    assert ref["seed"] >= 1
    assert "team_a_id" not in played[0] and "team_b_id" not in played[0]


def test_bye_matchup_has_null_team_b(client, admin_headers, db_session, seed):
    resp = _generate(client, admin_headers, db_session, seed)
    byes = [m for m in resp.json()["matchups"] if m["bye"]]
    if byes:
        assert byes[0]["team_b"] is None
```

**You must supply `_generate`.** This test file already contains a working
bracket-generation setup — the test that asserts `body["size"] == 4` around line
45 builds a season in playoffs with leagues, teams, and weekly scores. Extract
that existing setup into a module-level `_generate(client, admin_headers, db_session, seed)`
helper returning the POST response, and have the original test call it too, so the
setup exists in exactly one place. Do not duplicate the fixture-building code.

- [ ] **Step 2: Run them — expect FAIL**

Run: `cd backend && .venv/bin/pytest tests/api/admin/test_bracket.py -v`
Expected: FAIL — `team_a` missing (the response still has `team_a_id`), and the seed key set lacks `league_name`/`owner`.

- [ ] **Step 3: Update the schemas**

In `backend/app/api/admin/schemas.py`, import the public ref type and the owner ref:

```python
from app.api.public_schemas import BracketTeamRef, OwnerRef
```

Replace the two bracket schemas with:

```python
class BracketSeedAdmin(BaseModel):
    seed: int
    team_id: int
    qualified_via: QualifiedVia
    league_name: str
    owner: OwnerRef | None


class BracketMatchupAdmin(BaseModel):
    id: int
    round: int
    nfl_week: int
    team_a: BracketTeamRef | None
    team_b: BracketTeamRef | None
    team_a_score: float | None
    team_b_score: float | None
    winner_team_id: int | None
    is_finalized: bool
    bye: bool
```

Both lose `model_config = ConfigDict(from_attributes=True)` — they are now built
explicitly. If `ConfigDict` becomes unused in the file, leave the import alone
only if other schemas still use it; otherwise remove it so lint stays clean.

- [ ] **Step 4: Build the responses explicitly**

In `backend/app/api/admin/bracket.py`, add the imports:

```python
from app.api.public_schemas import BracketTeamRef, OwnerRef
from app.models import Owner, Team
```

Replace `_bracket_response` with:

```python
def _bracket_response(db: Session, bracket: Bracket) -> BracketAdminResponse:
    seeds = db.execute(
        select(BracketSeed)
        .where(BracketSeed.bracket_id == bracket.id)
        .order_by(BracketSeed.seed)
    ).scalars().all()
    seed_by_team = {s.team_id: s.seed for s in seeds}

    def team_ref(team_id: int | None) -> BracketTeamRef | None:
        if team_id is None:
            return None
        team = db.get(Team, team_id)
        owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
        return BracketTeamRef(
            team_id=team.id,
            seed=seed_by_team.get(team.id, 0),
            league_name=team.league.name,
            owner=OwnerRef.model_validate(owner) if owner is not None else None,
        )

    def score(value) -> float | None:
        return float(value) if value is not None else None

    matchups = db.execute(
        select(BracketMatchup)
        .where(BracketMatchup.bracket_id == bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
    ).scalars().all()

    return BracketAdminResponse(
        id=bracket.id,
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=[
            BracketSeedAdmin(
                seed=s.seed,
                team_id=s.team_id,
                qualified_via=s.qualified_via,
                league_name=db.get(Team, s.team_id).league.name,
                owner=(
                    OwnerRef.model_validate(db.get(Owner, db.get(Team, s.team_id).owner_id))
                    if db.get(Team, s.team_id).owner_id is not None
                    else None
                ),
            )
            for s in seeds
        ],
        matchups=[
            BracketMatchupAdmin(
                id=m.id,
                round=m.round,
                nfl_week=m.nfl_week,
                team_a=team_ref(m.team_a_id),
                team_b=team_ref(m.team_b_id),
                team_a_score=score(m.team_a_score),
                team_b_score=score(m.team_b_score),
                winner_team_id=m.winner_team_id,
                is_finalized=m.is_finalized,
                bye=m.bye,
            )
            for m in matchups
        ],
    )
```

**Then simplify the seeds comprehension.** As written above it calls
`db.get(Team, s.team_id)` three times per seed. Hoist it into a small loop that
fetches the team once per seed before constructing `BracketSeedAdmin`. Keep the
behaviour identical; the reviewer will check for this.

- [ ] **Step 5: Run the tests — expect PASS**

Run: `cd backend && .venv/bin/pytest tests/api/admin/test_bracket.py -v`, then the full `cd backend && .venv/bin/pytest`.
If the suite errors with `connection refused`, Postgres is down — report that, do not attempt to fix it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/admin/schemas.py backend/app/api/admin/bracket.py backend/tests/api/admin/test_bracket.py
git commit -m "feat(api): resolve team names and owners in the admin bracket response"
```

---

### Task 2: Frontend foundation — bracket types, hooks, MSW handlers

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/features/adminBracket.ts`
- Modify: `frontend/src/test/handlers.ts`
- Test: `frontend/src/features/adminBracket.test.tsx`

**Interfaces:**
- Produces (types): `BracketStatus`, `QualifiedVia`, `BracketTeamRef`, `BracketSeedAdmin`, `BracketMatchupAdmin`, `BracketAdminResponse` — exact shapes below. There are currently **no** bracket types in `frontend/src/types/api.ts`; you are adding the first.
- Produces (hooks): `useAdminBracket(seasonId: number | null)`, `useGenerateBracket(seasonId)`, `useApproveBracket(seasonId)`, `useFinalizeRound(seasonId)`. Tasks 4–6 consume these.

- [ ] **Step 1: Add the types**

Append to `frontend/src/types/api.ts`:

```ts
export type BracketStatus = "pending" | "active" | "complete";
export type QualifiedVia = "auto" | "wildcard";

export interface BracketTeamRef {
  team_id: number;
  seed: number;
  league_name: string;
  owner: OwnerRef | null;
}

export interface BracketSeedAdmin {
  seed: number;
  team_id: number;
  qualified_via: QualifiedVia;
  league_name: string;
  owner: OwnerRef | null;
}

export interface BracketMatchupAdmin {
  id: number;
  round: number;
  nfl_week: number;
  team_a: BracketTeamRef | null;
  team_b: BracketTeamRef | null;
  team_a_score: number | null;
  team_b_score: number | null;
  winner_team_id: number | null;
  is_finalized: boolean;
  bye: boolean;
}

export interface BracketAdminResponse {
  id: number;
  season_id: number;
  size: number;
  status: BracketStatus;
  seeds: BracketSeedAdmin[];
  matchups: BracketMatchupAdmin[];
}
```

`OwnerRef` is already exported from this file — do not redefine it.

- [ ] **Step 2: Write the failing hook test**

Create `frontend/src/features/adminBracket.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useAdminBracket } from "./adminBracket";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test("useAdminBracket returns a pending bracket with resolved teams", async () => {
  const { result } = renderHook(() => useAdminBracket(1), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.status).toBe("pending");
  expect(result.current.data?.seeds[0].league_name).toBe("Dynasty League");
  const played = result.current.data?.matchups.find((m) => !m.bye);
  expect(played?.team_a?.owner?.first_name).toBe("Maria");
});

test("useAdminBracket surfaces a 404 as an error the page can branch on", async () => {
  const { result } = renderHook(() => useAdminBracket(99), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
});

test("useAdminBracket stays idle for a null season", () => {
  const { result } = renderHook(() => useAdminBracket(null), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/features/adminBracket.test.tsx`
Expected: FAIL — cannot resolve `./adminBracket`.

- [ ] **Step 4: Add the MSW handlers**

In `frontend/src/test/handlers.ts`, add before the closing `];`. Season **1** has a
pending bracket; season **99** has none (404); season **7** has an active bracket.

```ts
  // --- admin: bracket (FE-3e) ---
  ...(() => {
    const maria = { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null };
    const jack = { id: 1, first_name: "Jack", last_name: "Altiere", display_name: "JackA", avatar_url: null };
    const refA = { team_id: 31, seed: 1, league_name: "Dynasty League", owner: maria };
    const refB = { team_id: 32, seed: 2, league_name: "Redraft Kings", owner: jack };
    const pending = {
      id: 5, season_id: 1, size: 2, status: "pending",
      seeds: [
        { seed: 1, team_id: 31, qualified_via: "auto", league_name: "Dynasty League", owner: maria },
        { seed: 2, team_id: 32, qualified_via: "wildcard", league_name: "Redraft Kings", owner: jack },
      ],
      matchups: [
        {
          id: 90, round: 1, nfl_week: 15, team_a: refA, team_b: refB,
          team_a_score: null, team_b_score: null, winner_team_id: null,
          is_finalized: false, bye: false,
        },
      ],
    };
    const active = {
      ...pending, id: 6, season_id: 7, status: "active",
      matchups: [
        {
          id: 91, round: 1, nfl_week: 15, team_a: refA, team_b: refB,
          team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31,
          is_finalized: true, bye: false,
        },
      ],
    };
    return [
      http.get("/api/admin/seasons/:id/bracket", ({ params }) => {
        if (params.id === "99") return HttpResponse.json({ detail: "Bracket not found" }, { status: 404 });
        if (params.id === "7") return HttpResponse.json(active);
        return HttpResponse.json(pending);
      }),
      http.post("/api/admin/seasons/:id/bracket", ({ params }) => {
        if (params.id === "8") {
          return HttpResponse.json({ detail: "Season is not in playoffs" }, { status: 409 });
        }
        return HttpResponse.json(pending, { status: 201 });
      }),
      http.post("/api/admin/seasons/:id/bracket/approve", () => HttpResponse.json({ ...pending, status: "active" })),
      http.post("/api/admin/seasons/:id/bracket/finalize-round", ({ params }) => {
        if (params.id === "7") {
          return HttpResponse.json({ detail: "Scores are not synced for week 15" }, { status: 409 });
        }
        return HttpResponse.json(active);
      }),
    ];
  })(),
```

- [ ] **Step 5: Create the hooks**

Create `frontend/src/features/adminBracket.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { BracketAdminResponse } from "@/types/api";

export function useAdminBracket(seasonId: number | null) {
  return useQuery({
    queryKey: ["adminBracket", seasonId],
    queryFn: () => apiClient.get<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket`),
    enabled: seasonId !== null,
    retry: false,
  });
}

export function useGenerateBracket(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}

export function useApproveBracket(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}

export function useFinalizeRound(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket/finalize-round`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}
```

`retry: false` on the query matters: a missing bracket is a 404 the page treats
as a real state, and retrying it just delays the empty state.

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/features/adminBracket.test.tsx` (expect PASS), then full `npm --prefix frontend test`, `run build`, `run lint` — all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/features/adminBracket.ts frontend/src/features/adminBracket.test.tsx frontend/src/test/handlers.ts
git commit -m "feat(frontend): FE-3e foundation — bracket types, hooks, MSW handlers"
```

---

### Task 3: `groupByRound` + the reusable `BracketRounds` component

**Files:**
- Create: `frontend/src/features/bracket.ts`
- Create: `frontend/src/components/BracketRounds.tsx`
- Test: `frontend/src/components/BracketRounds.test.tsx`

**Interfaces:**
- Produces: `groupByRound(matchups: BracketMatchupAdmin[]): BracketRound[]` where `BracketRound = { round: number; nfl_week: number; matchups: BracketMatchupAdmin[] }`, sorted by round ascending.
- Produces: `BracketRounds({ rounds, championTeamId }: { rounds: BracketRound[]; championTeamId?: number | null })` — **presentational only**: no hooks, no mutations, no data fetching, no admin assumptions. Task 4 composes it.

**Why presentational:** FE-2 (the public super-bracket view) has not been built. Task 1 made the admin and public matchup shapes match, so this component is the one FE-2 will reuse. Anything admin-specific belongs in the page, not here.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/BracketRounds.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { BracketRounds } from "./BracketRounds";
import { groupByRound } from "@/features/bracket";
import type { BracketMatchupAdmin, BracketTeamRef } from "@/types/api";

const maria: BracketTeamRef = {
  team_id: 31, seed: 1, league_name: "Dynasty League",
  owner: { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null },
};
const jack: BracketTeamRef = {
  team_id: 32, seed: 4, league_name: "Redraft Kings",
  owner: { id: 1, first_name: "Jack", last_name: "Altiere", display_name: "JackA", avatar_url: null },
};

function matchup(over: Partial<BracketMatchupAdmin> = {}): BracketMatchupAdmin {
  return {
    id: 1, round: 1, nfl_week: 15, team_a: maria, team_b: jack,
    team_a_score: null, team_b_score: null, winner_team_id: null,
    is_finalized: false, bye: false, ...over,
  };
}

test("groupByRound groups and orders rounds, carrying each round's week", () => {
  const rounds = groupByRound([
    matchup({ id: 3, round: 2, nfl_week: 16 }),
    matchup({ id: 1, round: 1, nfl_week: 15 }),
    matchup({ id: 2, round: 1, nfl_week: 15 }),
  ]);
  expect(rounds.map((r) => r.round)).toEqual([1, 2]);
  expect(rounds[0].matchups).toHaveLength(2);
  expect(rounds[1].nfl_week).toBe(16);
});

test("renders each round with its week, and both teams with seeds", () => {
  render(<BracketRounds rounds={groupByRound([matchup()])} />);
  expect(screen.getByText(/round 1/i)).toBeInTheDocument();
  expect(screen.getByText(/week 15/i)).toBeInTheDocument();
  expect(screen.getByText(/Maria Pappas/)).toBeInTheDocument();
  expect(screen.getByText(/JackA/)).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
});

test("a bye shows the advancing team and no opponent", () => {
  render(<BracketRounds rounds={groupByRound([matchup({ team_b: null, bye: true })])} />);
  expect(screen.getByText(/Maria Pappas/)).toBeInTheDocument();
  expect(screen.getByText(/bye/i)).toBeInTheDocument();
});

test("a finalized matchup shows scores and marks the winner", () => {
  render(
    <BracketRounds
      rounds={groupByRound([
        matchup({ team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31, is_finalized: true }),
      ])}
    />,
  );
  expect(screen.getByText("122.5")).toBeInTheDocument();
  expect(screen.getByText("98.25")).toBeInTheDocument();
  const winner = screen.getByTestId("team-31");
  expect(within(winner).getByLabelText(/winner/i)).toBeInTheDocument();
});

test("an unplayed matchup shows no scores", () => {
  render(<BracketRounds rounds={groupByRound([matchup()])} />);
  expect(screen.queryByTestId("score-31")).toBeNull();
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `npm --prefix frontend test -- src/components/BracketRounds.test.tsx`
Expected: FAIL — cannot resolve `./BracketRounds` / `@/features/bracket`.

- [ ] **Step 3: Create the grouping helper**

Create `frontend/src/features/bracket.ts`:

```ts
import type { BracketMatchupAdmin } from "@/types/api";

export interface BracketRound {
  round: number;
  nfl_week: number;
  matchups: BracketMatchupAdmin[];
}

/**
 * The admin payload is a flat matchup list; the public one arrives pre-grouped.
 * Grouping lives here so both callers agree on shape and ordering.
 */
export function groupByRound(matchups: BracketMatchupAdmin[]): BracketRound[] {
  const byRound = new Map<number, BracketMatchupAdmin[]>();
  for (const m of matchups) {
    const group = byRound.get(m.round);
    if (group) group.push(m);
    else byRound.set(m.round, [m]);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, group]) => ({ round, nfl_week: group[0].nfl_week, matchups: group }));
}

/** Deepest round number present, or 0 for an empty bracket. */
export function roundCount(matchups: BracketMatchupAdmin[]): number {
  return matchups.reduce((max, m) => (m.round > max ? m.round : max), 0);
}
```

- [ ] **Step 4: Create the presentational component**

Create `frontend/src/components/BracketRounds.tsx`:

```tsx
import { ownerName } from "@/features/standings";
import type { BracketRound } from "@/features/bracket";
import type { BracketTeamRef } from "@/types/api";

function TeamLine({
  team, score, isWinner, isChampion,
}: {
  team: BracketTeamRef | null;
  score: number | null;
  isWinner: boolean;
  isChampion: boolean;
}) {
  if (team === null) {
    return <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">—</div>;
  }
  return (
    <div
      data-testid={`team-${team.team_id}`}
      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
        isWinner ? "font-semibold text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-muted-foreground">({team.seed})</span>
        <span>{ownerName(team.owner)}</span>
        <span className="text-muted-foreground">{team.league_name}</span>
        {isWinner && <span aria-label="winner" className="text-highlight">✓</span>}
        {isChampion && <span aria-label="champion" className="text-highlight">🏆</span>}
      </span>
      {score !== null && (
        <span data-testid={`score-${team.team_id}`} className="tabular-nums">
          {score}
        </span>
      )}
    </div>
  );
}

export function BracketRounds({
  rounds, championTeamId = null,
}: {
  rounds: BracketRound[];
  championTeamId?: number | null;
}) {
  if (rounds.length === 0) {
    return <p className="text-muted-foreground">No rounds yet.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {rounds.map((r) => (
        <section key={r.round}>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Round {r.round} · week {r.nfl_week}
          </h2>
          <div className="flex flex-col gap-2">
            {r.matchups.map((m) => (
              <div key={m.id} className="divide-y rounded-xl border bg-card shadow-sm">
                <TeamLine
                  team={m.team_a}
                  score={m.team_a_score}
                  isWinner={m.winner_team_id !== null && m.winner_team_id === m.team_a?.team_id}
                  isChampion={championTeamId !== null && championTeamId === m.team_a?.team_id}
                />
                {m.bye ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">bye</div>
                ) : (
                  <TeamLine
                    team={m.team_b}
                    score={m.team_b_score}
                    isWinner={m.winner_team_id !== null && m.winner_team_id === m.team_b?.team_id}
                    isChampion={championTeamId !== null && championTeamId === m.team_b?.team_id}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

`ownerName` (`@/features/standings`) already returns `"—"` for a null owner, so an
unmapped team renders without crashing.

- [ ] **Step 5: Run tests + gate**

Run: `npm --prefix frontend test -- src/components/BracketRounds.test.tsx`, then full test, build, lint — green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/bracket.ts frontend/src/components/BracketRounds.tsx frontend/src/components/BracketRounds.test.tsx
git commit -m "feat(frontend): FE-3e reusable BracketRounds component + groupByRound"
```

---

### Task 4: Bracket page — four states, generate, route, season-detail link

**Files:**
- Create: `frontend/src/pages/admin/BracketAdminPage.tsx`
- Test: `frontend/src/pages/admin/BracketAdminPage.test.tsx`
- Modify: `frontend/src/routes.tsx`
- Modify: `frontend/src/pages/admin/SeasonDetailPage.tsx`

**Interfaces:**
- Consumes: `useAdminBracket`, `useGenerateBracket` (Task 2); `groupByRound` (Task 3); `BracketRounds` (Task 3); `useSeason` (`@/features/useSeasonDashboard`, key `["season", id]`); `NotFound`; `isApiError`; `Badge`; `Button`; the `Dialog` primitives.
- Produces: `BracketAdminPage`; route `/admin/seasons/:id/bracket`; a **Manage bracket** link on season detail.
- Approve/regenerate/finalize actions are added in Tasks 5 and 6 — this task renders the four states and ships **generate** only.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/BracketAdminPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path: string) {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

test("a pending bracket renders its seeds and rounds", async () => {
  renderAt("/admin/seasons/1/bracket");
  expect(await screen.findByText(/round 1/i)).toBeInTheDocument();
  expect(screen.getByText(/Maria Pappas/)).toBeInTheDocument();
  expect(screen.getByText("pending")).toBeInTheDocument();
});

test("no bracket in a playoffs season offers Generate", async () => {
  // season 99 has no bracket; make that season report playoffs status
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  expect(await screen.findByText(/no bracket yet/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /generate bracket/i })).toBeEnabled();
});

test("Generate is disabled when the season is not in playoffs", async () => {
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "regular",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  expect(await screen.findByRole("button", { name: /generate bracket/i })).toBeDisabled();
  expect(screen.getByText(/must be in playoffs/i)).toBeInTheDocument();
});

test("generating asks for confirmation first", async () => {
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  await userEvent.click(await screen.findByRole("button", { name: /generate bracket/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^generate$/i })).toBeInTheDocument();
});

test("an active bracket shows scores and no generate action", async () => {
  renderAt("/admin/seasons/7/bracket");
  expect(await screen.findByText("active")).toBeInTheDocument();
  expect(screen.getByText("122.5")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /generate bracket/i })).toBeNull();
});

test("a non-numeric season id renders not-found", async () => {
  renderAt("/admin/seasons/abc/bracket");
  expect(await screen.findByText(/bracket not found|season not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/BracketAdminPage.test.tsx`

- [ ] **Step 3: Create the page**

Create `frontend/src/pages/admin/BracketAdminPage.tsx`:

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminBracket, useGenerateBracket } from "@/features/adminBracket";
import { useSeason } from "@/features/useSeasonDashboard";
import { groupByRound } from "@/features/bracket";
import { BracketRounds } from "@/components/BracketRounds";
import { NotFound } from "@/pages/NotFound";
import { isApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function BracketAdminPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const navigate = useNavigate();

  const season = useSeason(valid ? id : null);
  const bracket = useAdminBracket(valid ? id : null);
  const generate = useGenerateBracket(valid ? id : 0);

  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!valid) return <NotFound title="Season not found" message="We couldn't find that season." />;
  if (bracket.isPending || season.isPending) return <p className="text-muted-foreground">Loading…</p>;

  const missing = bracket.isError && isApiError(bracket.error) && bracket.error.status === 404;
  if (bracket.isError && !missing) {
    return <p className="text-destructive">Couldn't load the bracket.</p>;
  }

  const inPlayoffs = season.data?.status === "playoffs";

  async function onGenerate() {
    setError(null);
    try {
      await generate.mutateAsync();
      setConfirmGenerate(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Generate failed");
    }
  }

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Bracket{season.data ? ` · ${season.data.year}` : ""}
        </h1>
        {!missing && <Badge variant="secondary">{bracket.data!.status}</Badge>}
      </div>

      {missing ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
          <p className="font-medium">No bracket yet.</p>
          {!inPlayoffs && (
            <p className="text-sm text-muted-foreground">
              The season must be in playoffs before a bracket can be generated.
            </p>
          )}
          <Button disabled={!inPlayoffs} onClick={() => setConfirmGenerate(true)}>
            Generate bracket
          </Button>
        </div>
      ) : (
        <BracketRounds rounds={groupByRound(bracket.data!.matchups)} />
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      <Dialog
        open={confirmGenerate}
        onOpenChange={(o) => { setConfirmGenerate(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate the bracket?</DialogTitle>
            <DialogDescription>
              Builds the playoff field from current standings. You can review it before approving.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onGenerate} disabled={generate.isPending}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Note the hooks all run before the early returns — `useSeason` and `useAdminBracket`
are `enabled`-gated on a null id, so an invalid param fires no request.

- [ ] **Step 4: Wire the route**

In `frontend/src/routes.tsx`, import `BracketAdminPage` and add, **inside the same
`<ProtectedRoute requireRole="super_admin" />` children array** that holds the
accounts routes:

```tsx
{ path: "seasons/:id/bracket", element: <BracketAdminPage /> },
```

- [ ] **Step 5: Add the season-detail link**

In `frontend/src/pages/admin/SeasonDetailPage.tsx`, import `Link` from
`react-router-dom` if it is not already imported, and add a Manage-bracket action
next to the season header (the `<h1>Season {season.year}</h1>` / `<Badge>` row
around line 36):

```tsx
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/seasons/${season.id}/bracket`}>Manage bracket</Link>
        </Button>
```

- [ ] **Step 6: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/BracketAdminPage.test.tsx src/pages/admin/SeasonDetailPage.test.tsx src/pages/admin/SeasonDetailPage.actions.test.tsx`, then full test, build, lint — green. The two season-detail suites must still pass unedited.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/BracketAdminPage.tsx frontend/src/pages/admin/BracketAdminPage.test.tsx frontend/src/routes.tsx frontend/src/pages/admin/SeasonDetailPage.tsx
git commit -m "feat(frontend): FE-3e bracket page — states, generate, season-detail link"
```

---

### Task 5: Approve + regenerate, with the playoff-weeks warning

**Files:**
- Modify: `frontend/src/pages/admin/BracketAdminPage.tsx`
- Test: `frontend/src/pages/admin/BracketApprove.test.tsx`

**Interfaces:**
- Consumes: `useApproveBracket` (Task 2); `roundCount` (Task 3, `@/features/bracket`); `useSeason`'s `nfl_playoff_weeks`.
- Produces: Approve and Regenerate actions shown only while the bracket status is `pending`.

**The warning:** bracket depth is not validated against the season's playoff weeks
at approval time — a too-short season only fails with a 422 at finalize time,
possibly weeks later. So the approve dialog compares `roundCount(matchups)` against
`season.nfl_playoff_weeks.length` and warns when rounds exceed weeks. It is
**advisory** — it must NOT block approval, because the backend permits it and the
weeks can still be edited afterwards.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/BracketApprove.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/1/bracket") {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

/** Season 1 with a given number of playoff weeks. */
function seasonWithWeeks(weeks: number[]) {
  server.use(
    http.get("/api/seasons/1", () =>
      HttpResponse.json({
        id: 1, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: weeks, leagues: [],
      }),
    ),
  );
}

test("a pending bracket offers Approve and Regenerate", async () => {
  seasonWithWeeks([15, 16, 17]);
  renderAt();
  expect(await screen.findByRole("button", { name: /approve bracket/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
});

test("approving warns that it cannot be undone", async () => {
  seasonWithWeeks([15, 16, 17]);
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(await screen.findByText(/can't be undone|cannot be undone/i)).toBeInTheDocument();
});

test("no warning when the season has enough playoff weeks", async () => {
  seasonWithWeeks([15]); // 1 week, bracket has 1 round → rounds do NOT exceed weeks
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(screen.queryByText(/more rounds than/i)).toBeNull();
});

test("warns when rounds exceed available weeks", async () => {
  seasonWithWeeks([]); // 0 weeks, bracket has 1 round → warning
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(await screen.findByText(/more rounds than/i)).toBeInTheDocument();
  // advisory only — approval is still possible
  expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
});

test("an active bracket offers neither Approve nor Regenerate", async () => {
  renderAt("/admin/seasons/7/bracket");
  await screen.findByText("active");
  expect(screen.queryByRole("button", { name: /approve bracket/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/BracketApprove.test.tsx`

- [ ] **Step 3: Add approve + regenerate to the page**

In `frontend/src/pages/admin/BracketAdminPage.tsx`:

Add imports:

```tsx
import { useApproveBracket } from "@/features/adminBracket";
import { roundCount } from "@/features/bracket";
```

Add these hooks alongside the existing ones, **before the early returns**:

```tsx
  const approve = useApproveBracket(valid ? id : 0);
  const [confirmApprove, setConfirmApprove] = useState(false);
```

After the `onGenerate` function add:

```tsx
  async function onApprove() {
    setError(null);
    try {
      await approve.mutateAsync();
      setConfirmApprove(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Approve failed");
    }
  }
```

Compute the pending-state values after the early returns, next to where the
bracket data is used:

```tsx
  const isPending = !missing && bracket.data!.status === "pending";
  const rounds = missing ? 0 : roundCount(bracket.data!.matchups);
  const weeks = season.data?.nfl_playoff_weeks.length ?? 0;
  const tooFewWeeks = isPending && rounds > weeks;
```

Render the action bar directly below `<BracketRounds …/>`, shown only when pending:

```tsx
      {isPending && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setConfirmGenerate(true)}>Regenerate</Button>
          <Button onClick={() => setConfirmApprove(true)}>Approve bracket</Button>
        </div>
      )}
```

And add the approve dialog beside the generate one:

```tsx
      <Dialog
        open={confirmApprove}
        onOpenChange={(o) => { setConfirmApprove(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this bracket?</DialogTitle>
            <DialogDescription>
              Approving publishes the bracket publicly and starts the playoffs. This can't be
              undone — regenerate now if the field looks wrong.
            </DialogDescription>
          </DialogHeader>
          {tooFewWeeks && (
            <p className="text-sm text-highlight">
              ⚠ This bracket needs {rounds} rounds but the season has more rounds than playoff
              weeks ({weeks} configured). Finalizing the later rounds will fail until you add weeks.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onApprove} disabled={approve.isPending}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

**Also update the generate dialog's copy** for the regenerate case: when a bracket
already exists, its description must say the existing draft will be discarded and
replaced. Branch the `DialogDescription` on `missing`.

- [ ] **Step 4: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/BracketApprove.test.tsx src/pages/admin/BracketAdminPage.test.tsx`, then full test, build, lint — green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/BracketAdminPage.tsx frontend/src/pages/admin/BracketApprove.test.tsx
git commit -m "feat(frontend): FE-3e approve + regenerate with playoff-weeks warning"
```

---

### Task 6: Finalize round

**Files:**
- Modify: `frontend/src/pages/admin/BracketAdminPage.tsx`
- Test: `frontend/src/pages/admin/BracketFinalize.test.tsx`

**Interfaces:**
- Consumes: `useFinalizeRound` (Task 2); `groupByRound` (Task 3).
- Produces: a Finalize-round action shown only while the bracket status is `active`, naming the round and NFL week it will settle, plus the champion marker once complete.

**The finalize errors are the operationally useful ones** and must reach the admin
verbatim: `"Scores are not synced…"` tells them to run Sync first,
nothing-to-finalize means the week is not done, and not-enough-playoff-weeks is a
season-config problem. Surface `ApiError.detail` unchanged.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/BracketFinalize.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/7/bracket") {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

test("an active bracket offers Finalize round naming the round and week", async () => {
  renderAt();
  const button = await screen.findByRole("button", { name: /finalize round/i });
  expect(button).toBeInTheDocument();
  await userEvent.click(button);

  // "Round 1 · week 15" also appears in the page's own round heading, so scope
  // these assertions to the dialog or they match two nodes and RTL throws.
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByText(/round 1/i)).toBeInTheDocument();
  expect(dialog.getByText(/week 15/i)).toBeInTheDocument();
  expect(dialog.getByText(/can't be undone|cannot be undone/i)).toBeInTheDocument();
});

test("a finalize refusal surfaces the server message inline", async () => {
  // season 7's finalize handler returns 409 "Scores are not synced for week 15"
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /finalize round/i }));
  await userEvent.click(screen.getByRole("button", { name: /^finalize$/i }));
  expect(await screen.findByText(/scores are not synced/i)).toBeInTheDocument();
});

test("a pending bracket offers no finalize action", async () => {
  renderAt("/admin/seasons/1/bracket");
  await screen.findByText("pending");
  expect(screen.queryByRole("button", { name: /finalize round/i })).toBeNull();
});

test("a complete bracket marks the champion and offers no actions", async () => {
  server.use(
    http.get("/api/admin/seasons/7/bracket", () =>
      HttpResponse.json({
        id: 6, season_id: 7, size: 2, status: "complete",
        seeds: [],
        matchups: [
          {
            id: 91, round: 1, nfl_week: 15,
            team_a: { team_id: 31, seed: 1, league_name: "Dynasty League", owner: { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null } },
            team_b: { team_id: 32, seed: 2, league_name: "Redraft Kings", owner: null },
            team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31,
            is_finalized: true, bye: false,
          },
        ],
      }),
    ),
  );
  renderAt();
  await screen.findByText("complete");
  expect(screen.getByLabelText(/champion/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /finalize round/i })).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --prefix frontend test -- src/pages/admin/BracketFinalize.test.tsx`

- [ ] **Step 3: Add finalize to the page**

In `frontend/src/pages/admin/BracketAdminPage.tsx`:

Add the import:

```tsx
import { useFinalizeRound } from "@/features/adminBracket";
```

Add alongside the other hooks, **before the early returns**:

```tsx
  const finalize = useFinalizeRound(valid ? id : 0);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
```

Add the handler next to the others:

```tsx
  async function onFinalize() {
    setError(null);
    try {
      await finalize.mutateAsync();
      setConfirmFinalize(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Finalize failed");
    }
  }
```

After the existing computed values, derive the active-state values. The next round
to finalize is the first round whose matchups are not all finalized, and the
champion is the winner of the deepest round's matchup once complete:

```tsx
  const grouped = missing ? [] : groupByRound(bracket.data!.matchups);
  const isActive = !missing && bracket.data!.status === "active";
  const isComplete = !missing && bracket.data!.status === "complete";
  const nextRound = grouped.find((r) => r.matchups.some((m) => !m.is_finalized)) ?? null;
  const champion = isComplete
    ? grouped[grouped.length - 1]?.matchups[0]?.winner_team_id ?? null
    : null;
```

Pass the champion to the renderer: `<BracketRounds rounds={grouped} championTeamId={champion} />`
(replace the existing `groupByRound(...)` call so grouping happens once).

Render the finalize action, only while active and only when a round remains:

```tsx
      {isActive && nextRound && (
        <div className="mt-4">
          <Button onClick={() => setConfirmFinalize(true)}>Finalize round</Button>
        </div>
      )}
```

And the dialog:

```tsx
      <Dialog
        open={confirmFinalize}
        onOpenChange={(o) => { setConfirmFinalize(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Finalize round {nextRound?.round} · week {nextRound?.nfl_week}?
            </DialogTitle>
            <DialogDescription>
              Locks this round's scores, advances the winners, and creates the next round.
              This can't be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onFinalize} disabled={finalize.isPending}>Finalize</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Run tests + gate**

Run: `npm --prefix frontend test -- src/pages/admin/BracketFinalize.test.tsx src/pages/admin/BracketApprove.test.tsx src/pages/admin/BracketAdminPage.test.tsx`, then full test, build, lint — green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/BracketAdminPage.tsx frontend/src/pages/admin/BracketFinalize.test.tsx
git commit -m "feat(frontend): FE-3e finalize round + champion marker"
```

---

## Post-implementation

- **Visual eyeball (non-code gate):** run the app (`API_PROXY_TARGET=http://localhost:8123 npm --prefix frontend run dev`) against a seeded backend with a season in playoffs: generate a bracket, review the draft, approve it, and finalize a round — in light + dark and at a narrow width. This gate is **also still owed for FE-3c and FE-3d and the collapsed mobile rail** — do them in one pass.
- **PRs:** Task 1 ships as its own backend PR; Tasks 2–6 as the FE-3e PR. Both per [[git-workflow]]. No sensitive data.

## Self-review notes (author check)

- **Spec coverage:** backend enrichment (T1); types/hooks/handlers (T2); the reusable presentational component + grouping the spec calls for (T3); the four page states, the playoffs-gated generate, the route and season-detail link (T4); approve + regenerate + the advisory playoff-weeks warning (T5); finalize with verbatim server errors and the champion marker (T6). Confirmations on all three state-changing actions: generate/regenerate (T4/T5), approve (T5), finalize (T6).
- **Type consistency:** `BracketAdminResponse`/`BracketSeedAdmin`/`BracketMatchupAdmin`/`BracketTeamRef` defined in T2 mirror T1's backend shapes and are used unchanged in T3–T6. `groupByRound`/`roundCount`/`BracketRound` defined in T3 and consumed in T4/T5/T6. `BracketRounds` props `{rounds, championTeamId?}` identical in T3's definition and T4/T6's use.
- **Known limitations carried from the spec:** nothing sets `Season.status = COMPLETE` when a bracket finishes, so the season stays in `playoffs`; the playoff-weeks warning is advisory and client-side; regeneration destroys a pending draft with no history.
- **Environment:** the backend suite needs Postgres on :5432 — a wholesale `connection refused` failure is environmental, not a code defect.
