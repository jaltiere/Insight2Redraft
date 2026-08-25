# FE-3e: Bracket Admin — Design

Date: 2026-08-25
Track: Frontend admin area (FE-3), fifth and final slice. Follows FE-3a (shell/auth), FE-3b (seasons/leagues), FE-3c (owners/mapping), FE-3d (accounts/grants).
Branch: `plan/fe-3e-bracket-admin`

## Goal

Give the super-admin a UI to run the site's super-bracket: generate a draft,
review it, approve it, and finalize each round as the playoffs progress. These
are the last admin endpoints with no frontend surface, so completing this slice
satisfies [[admin-capabilities-need-ui]] for the whole admin backlog.

Two deliverables, in order:

1. **Backend cycle — enrich the admin bracket response** so a draft can be
   reviewed by a human. Ships as its own PR.
2. **FE-3e — the bracket admin screen.**

## The problem the backend cycle solves

`GET /admin/seasons/{id}/bracket` currently returns bare integers —
`BracketSeedAdmin.team_id`, `BracketMatchupAdmin.team_a_id`/`team_b_id` — with
no names, owners, or league names.

The *public* endpoint (`app/api/bracket.py`) already resolves all of that into
`BracketTeamRef { team_id, seed, league_name, owner }`, but it serves only
`ACTIVE` and `COMPLETE` brackets: `_PUBLIC_STATUSES` deliberately excludes
`PENDING`, so a draft is unreachable there. `SeasonDetail` carries leagues but
not teams, so there is no cheap client-side join either.

The consequence is that the draft-review screen — the one moment a human decides
whether the computed playoff field is correct before approving it — would render
"Team 47 vs Team 12". That defeats the purpose of the review step, so the admin
response is enriched instead.

### Backend changes (`backend/app/api/admin/schemas.py`, `admin/bracket.py`)

- `BracketSeedAdmin` gains `league_name: str` and `owner: OwnerRef | None`.
- `BracketMatchupAdmin` replaces `team_a_id`/`team_b_id: int | None` with
  `team_a`/`team_b: BracketTeamRef | None`, mirroring the public shape.
- `_bracket_response` resolves teams the way `app/api/bracket.py::team_ref` does.

**This is a breaking change to that endpoint's response shape.** It is cheap
here because the endpoint has no consumers — the frontend never had bracket
admin — but `backend/tests/api/admin/test_bracket.py` asserts the current shape
and must move with it in the same cycle. Reuse the public `BracketTeamRef` type
rather than defining a parallel one.

## Roles

Super-admin only, backend-enforced: `app/api/admin/bracket.py` declares
`dependencies=[Depends(require_super_admin)]` on the whole router. The UI route
sits inside the existing `<ProtectedRoute requireRole="super_admin" />` block.

## Backend contract (already shipped)

- `POST /admin/seasons/{id}/bracket` → 201 `BracketAdminResponse`. **404** season
  not found; **409** `"Season is not in playoffs"`; **422** on a generation error.
  If a `PENDING` bracket exists it is **deleted and regenerated**; if one exists
  and is not pending, **409** `"Bracket already approved"`.
- `GET /admin/seasons/{id}/bracket` → `BracketAdminResponse`; **404** `"Bracket not found"`.
- `POST /admin/seasons/{id}/bracket/approve` → `BracketAdminResponse`; **404**;
  **409** `"Bracket is not pending"`. **One-way — there is no un-approve endpoint.**
- `POST /admin/seasons/{id}/bracket/finalize-round` → `BracketAdminResponse`;
  **404**; **409** `"Bracket is not active"`, scores-not-synced, or
  nothing-to-finalize; **422** not-enough-playoff-weeks.

`BracketStatus` is `pending | active | complete`. `QualifiedVia` is `auto | wildcard`.

## Screen

One route, `/admin/seasons/:id/bracket`, reached from a **Manage bracket** button
on the season detail page — a bracket belongs to exactly one season, and this
mirrors how the mapping worksheet hangs off `/admin/leagues/:id/mapping`. No new
nav entry.

The page renders four states off the bracket query plus the season:

- **No bracket (404).** If `season.status === "playoffs"`, show an empty state and
  a **Generate bracket** button. If it is any other status, explain that
  generation requires the season to be in playoffs and **disable** the button —
  preventing the 409 rather than surfacing it.
- **PENDING (draft).** Seed list (seed number, owner, league, `auto`/`wildcard`)
  and the rounds. Actions: **Regenerate** and **Approve bracket**.
- **ACTIVE.** Rounds with scores, winners, and finalized markers. Action:
  **Finalize round**, labelled with the round and NFL week it will settle.
- **COMPLETE.** Read-only, no actions. The champion is the `winner_team_id` of
  the deepest round's single matchup; mark that team rather than computing a
  winner independently.

An invalid or unknown `:id` renders the shared `NotFound`, as on the other
detail pages.

## Confirmations

All three state-changing actions confirm before running, matching how
delete-league and delete-account already behave:

- **Regenerate** — says the existing draft will be discarded and replaced.
- **Approve** — says approval is final and publishes the bracket publicly (an
  approved bracket becomes visible on the public endpoint). There is no
  un-approve endpoint, so this is the last chance to regenerate.
- **Finalize round** — names the round and week, and says advancement cannot be
  undone.

## Reusable bracket rendering

FE-2 (the public super-bracket view) has not been built. This slice therefore
creates the app's first bracket rendering, and it is built to be reused:

`BracketRounds` is a **presentational** component taking already-resolved rounds
and rendering the matchup grid — no hooks, no mutations, no admin assumptions.
The admin page composes it with the action bar. When FE-2 lands it can render the
public payload through the same component, since the backend cycle above makes
the admin and public matchup shapes match.

Grouping flat matchups into rounds (the admin payload is a flat list; the public
one is pre-grouped) lives in a small `groupByRound` helper so both callers agree.

## Playoff-weeks warning

`api4c-followups` records that bracket depth is **not** validated against the
season's playoff weeks at approval time — a too-short season only fails with a
422 `NotEnoughPlayoffWeeks` at finalize time, potentially weeks later.

The approve confirmation therefore compares the draft's deepest round against
`season.nfl_playoff_weeks.length` and, when rounds exceed weeks, shows a warning
naming both numbers. It is **advisory only** — approval is not blocked, because
the backend permits it and the season's weeks can still be edited afterwards.
This is a UI mitigation of a backend gap, not a substitute for one; a future
backend cycle should validate at approval.

## Data flow

- `useAdminBracket(seasonId)` — `GET /admin/seasons/{id}/bracket`, key
  `["adminBracket", seasonId]`. A 404 is a real state (no bracket yet), not an
  error to hide: the page branches on it rather than showing a failure.
- `useSeason(seasonId)` — the existing FE-1 hook, key `["season", id]`, for the
  year, status, and playoff weeks.
- `useGenerateBracket`, `useApproveBracket`, `useFinalizeRound` all invalidate
  `["adminBracket", seasonId]`. There is no public bracket query key to invalidate
  yet — FE-2 does not exist, and a repo-wide search finds no `["bracket", …]` key.
  When FE-2 lands it must add that invalidation to `useApproveBracket`, since
  approval is what makes a bracket publicly visible.

## Error handling

Every mutation surfaces `ApiError.detail` inline in its dialog, never a toast —
consistent with FE-3b/3c/3d. The finalize errors are the operationally useful
ones and must reach the admin verbatim: scores-not-synced tells them to run Sync
first, nothing-to-finalize means the week is not done, and not-enough-playoff-weeks
is a season-configuration problem.

## Testing

Vitest + RTL + MSW, `onUnhandledRequest: "error"`, using `@/test/renderWithAuth`.
New MSW handlers for the four bracket endpoints, including the 404-no-bracket
case and the 409/422 paths.

Coverage: each of the four page states renders its correct actions; generate is
disabled when the season is not in playoffs; regenerate/approve/finalize each
confirm before firing; a finalize 409 surfaces its message inline; the
playoff-weeks warning appears when rounds exceed weeks and not otherwise;
`BracketRounds` renders byes, scores, and winners from plain props.

Gate per task: `npm --prefix frontend run build`, `test`, `lint` green; the
backend cycle gated by `pytest`.

## Non-goals

- **Editing seeds or matchups by hand.** No endpoint exists; the bracket is
  generated or it is not.
- **Un-approving or deleting an approved bracket.** No endpoint. Regeneration is
  possible only while `PENDING`.
- **The public bracket view (FE-2).** This slice builds the reusable renderer but
  not the public page.
- Entering scores — those arrive from the sync worker.

## Known limitations

- **Nothing sets `Season.status = COMPLETE`** when a bracket finishes
  ([[api4c-followups]]), so a season stays in `playoffs` forever and the worker
  never quiesces. The UI cannot fix this and does not pretend to; the bracket's
  own `complete` status is what the page reflects.
- The playoff-weeks warning above is advisory and client-side only.
- Generating replaces a pending bracket destructively. The confirmation is the
  only guard — there is no draft history.
