# Bracket Generation + Approval + Public Read (API-4b) — Design

**Date:** 2026-08-04
**Status:** Design approved; ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-23-cross-league-fantasy-platform-design.md`

## Summary

Bring a super-bracket into existence and expose it. A super-admin generates a
bracket for a season entering the playoffs (seeding the pooled field and
creating the round-1 matchups via the pure `bracket_engine`), reviews the
PENDING draft, and approves it to ACTIVE. The public read exposes an
ACTIVE/COMPLETE bracket for the frontend's centerpiece view. Round-by-round
advancement and live scores are the next cycle (API-4c).

This is the second of the three decomposed **API-4 (super-bracket)** cycles:

- **API-4a (merged)** — `bracket_engine` pure logic (`app/bracket/engine.py`).
- **API-4b (this spec)** — generation + approval + public read.
- **API-4c (later)** — round finalization + advancement + worker live scores.

## Goals

- `generate_bracket(session, season)` — a DB-bound orchestrator that seeds the
  field and creates the `Bracket` + `BracketSeed` + round-1 `BracketMatchup`
  rows from final standings, using the 4a engine.
- Super-admin endpoints: generate (PENDING draft), approve (PENDING→ACTIVE),
  and an admin read (any status) for review.
- Public read: an ACTIVE/COMPLETE bracket grouped into rounds, teams enriched
  with seed + owner + league name.

## Non-Goals (this cycle)

- No round-to-round advancement, no score population, no "finalize round" — that
  is API-4c. Generation creates **round 1 only**; game scores/winners are null
  (byes excepted).
- No auto-generation on the season status flip — generation is an explicit
  super-admin action.
- No bracket-delete endpoint. Re-generating while PENDING replaces the draft;
  that covers "redo". (An ACTIVE/COMPLETE bracket is not regenerable.)
- No wildcard berths (top-N per league only; `qualified_via` is always `AUTO`).
- No model changes, no migration — the bracket tables already exist (Plan 1).

## Cross-Cutting Requirement (not built here)

Per a standing product rule ([[admin-capabilities-need-ui]]): the three
super-admin endpoints defined here (generate, approve, admin-read) must
eventually be driven from the frontend admin UI — no real user should hit them
via Postman/curl. The frontend is a separate future track; these endpoints are
its backend contract and are on the admin-UI backlog.

## Existing State (grounding)

- Models (`app/models/bracket.py`): `Bracket(season_id unique, size, status:
  PENDING|ACTIVE|COMPLETE)`, `BracketSeed(bracket_id, team_id, seed,
  qualified_via: AUTO|WILDCARD)` unique `(bracket_id, seed)` and `(bracket_id,
  team_id)`, `BracketMatchup(bracket_id, round, nfl_week, team_a_id, team_b_id,
  team_a_score, team_b_score, winner_team_id, is_finalized, bye)`. All FKs
  `ondelete=CASCADE` from `bracket` (seeds/matchups cascade on bracket delete);
  `Bracket.season_id` is `ondelete=CASCADE`, unique.
- 4a engine (`app/bracket/engine.py`, pure): `seed_field(standings,
  field_per_league) -> list[SeededTeam{team_id, seed}]`;
  `generate_round(remaining) -> RoundPlan{games: list[RoundGame{high, low}],
  byes: list[team_id]}` (requires N>=2); dataclasses `TeamStanding{team_id,
  league_id, wins, losses, ties, points_for}`, `RemainingTeam{team_id, seed}`.
  See [[bracket-engine-interface]].
- `Team`: `league_id`, `owner_id` (nullable), `wins/losses/ties/points_for`,
  `.league` relationship (→ `League.name`). No `owner` relationship — resolve
  via `db.get(Owner, team.owner_id)`.
- `Season`: `status: SeasonStatus (SETUP|REGULAR|PLAYOFFS|COMPLETE)`,
  `playoff_field_per_league`, `nfl_playoff_weeks: list[int]`, `.leagues`
  relationship.
- Admin routers convention: `APIRouter(prefix="/admin", tags=["admin"],
  dependencies=[Depends(require_super_admin)])`; write paths `db.commit()`.
- Public routers convention (API-2): `APIRouter(tags=["public"])`, no auth,
  `from_attributes` schemas, scores as `float` in JSON, `OwnerRef{id,
  first_name, last_name, display_name, avatar_url}`.

## Generation Service (`app/bracket/generation.py`)

`generate_bracket(session: Session, season: Season) -> Bracket`

1. Build `TeamStanding`s for every team across `season.leagues` (team_id,
   league_id, wins, losses, ties, points_for).
2. `seeds = seed_field(standings, season.playoff_field_per_league)`.
3. **Guards** (raise a domain error the endpoint maps to 422):
   - `len(seeds) >= 2` else "not enough teams to form a bracket".
   - `season.nfl_playoff_weeks` non-empty else "season has no playoff weeks
     configured".
4. Create `Bracket(season_id=season.id, size=len(seeds), status=PENDING)`;
   flush to get its id.
5. Create a `BracketSeed(bracket_id, team_id, seed, qualified_via=AUTO)` per
   `SeededTeam`.
6. Round 1: `plan = generate_round([RemainingTeam(team_id, seed) for seeds])`;
   `week = season.nfl_playoff_weeks[0]`.
   - Each `RoundGame(high, low)` → `BracketMatchup(bracket_id, round=1,
     nfl_week=week, team_a_id=high, team_b_id=low, bye=False,
     is_finalized=False)` (scores/winner null).
   - Each `bye` team_id → `BracketMatchup(bracket_id, round=1, nfl_week=week,
     team_a_id=bye, team_b_id=None, bye=True, winner_team_id=bye,
     is_finalized=True)`.
7. `flush`; return the `Bracket` (caller commits). The service flushes but does
   not commit — the endpoint owns the transaction.

Define the guard failures as a small `BracketGenerationError` (in
`app/bracket/generation.py`) so the endpoint can map it to 422.

## Admin Endpoints (`app/api/admin/bracket.py`, router-level `require_super_admin`)

| Method & path | Behavior | Errors |
|---|---|---|
| `POST /admin/seasons/{season_id}/bracket` | generate a PENDING draft | 404 unknown season; 409 season not PLAYOFFS; 409 existing ACTIVE/COMPLETE bracket; 422 generation guard |
| `POST /admin/seasons/{season_id}/bracket/approve` | PENDING→ACTIVE | 404 no bracket; 409 not PENDING |
| `GET /admin/seasons/{season_id}/bracket` | bracket in any status | 404 no bracket |

- **Generate**: `db.get(Season)` → 404. Require `season.status == PLAYOFFS` →
  else 409. Look up existing `Bracket` by `season_id`: if `ACTIVE`/`COMPLETE` →
  409; if `PENDING` → `db.delete()` it (cascades its seeds/matchups) and flush
  before regenerating. Call `generate_bracket`; on `BracketGenerationError` →
  422. `db.commit()`; return `BracketAdminResponse`.
- **Approve**: load bracket by `season_id` → 404; require `PENDING` → else 409;
  set `status = ACTIVE`; `db.commit()`; return `BracketAdminResponse`.
- **Admin read**: load bracket by `season_id` → 404; return
  `BracketAdminResponse` (seeds + all matchups, any status).

## Public Read (`app/api/bracket.py`, `tags=["public"]`, no auth)

`GET /seasons/{season_id}/bracket` — load bracket by `season_id`; if absent **or
status is PENDING** → 404 (drafts are not public). Return `BracketPublic` with
matchups grouped into rounds (ascending `round`, then `id`), each team enriched
with its seed (from `BracketSeed`), `league_name` (`Team.league.name`), and
`owner` (`Owner` via `team.owner_id`). Scores are `float | None`.

## Schemas

**Admin** (`app/api/admin/schemas.py`):

- `BracketSeedAdmin{seed: int, team_id: int, qualified_via: QualifiedVia}`
- `BracketMatchupAdmin{id, round, nfl_week, team_a_id: int|None, team_b_id:
  int|None, team_a_score: float|None, team_b_score: float|None,
  winner_team_id: int|None, is_finalized: bool, bye: bool}`
- `BracketAdminResponse{id, season_id, size, status: BracketStatus,
  seeds: list[BracketSeedAdmin], matchups: list[BracketMatchupAdmin]}`
  (matchups ordered by `round`, then `id`; seeds by `seed`)

**Public** (`app/api/public_schemas.py`):

- `BracketTeamRef{team_id: int, seed: int, league_name: str, owner: OwnerRef|None}`
- `BracketMatchupPublic{round: int, nfl_week: int, bye: bool, is_finalized: bool,
  team_a: BracketTeamRef|None, team_b: BracketTeamRef|None,
  team_a_score: float|None, team_b_score: float|None, winner_team_id: int|None}`
- `BracketRoundPublic{round: int, nfl_week: int, matchups: list[BracketMatchupPublic]}`
- `BracketPublic{season_id: int, size: int, status: BracketStatus,
  seeds: list[BracketTeamRef], rounds: list[BracketRoundPublic]}`

Enums (`BracketStatus`, `QualifiedVia`) serialize to their `.value`.

## Error Mapping (consistent with 3a/3b/3c)

- `401` no token / `403` non-super-admin on admin routes (router-level gate).
- Generate: `404` unknown season; `409` season not PLAYOFFS or existing
  ACTIVE/COMPLETE bracket; `422` too-few-teams or no-playoff-weeks.
- Approve: `404` no bracket; `409` not PENDING.
- Admin read / public read: `404` when no bracket (public also 404 on PENDING).

## Testing Strategy

Test-driven, Postgres-backed. Reuse `client`, `admin_headers`, `make_account`,
`seed`, `db_session`. Extend `seed` if needed to build teams with standings +
owners (the existing `seed.team`/`seed.owner` already support this).

- **`tests/bracket/test_generation.py`** (service, DB but no HTTP): seeds the
  expected pooled order; creates `size == K`; round-1 games pair high-vs-low and
  byes become `bye=True` matchups with `winner_team_id` set + `is_finalized`;
  `nfl_week` = first playoff week; 422-domain error on `< 2` qualifiers and on
  empty `nfl_playoff_weeks`; PENDING status on the new bracket.
- **`tests/api/admin/test_bracket.py`**: generate on a PLAYOFFS season returns
  the draft (seeds + round-1 matchups incl. a bye); 409 when season is REGULAR;
  regenerating while PENDING replaces (old rows gone, one bracket); 409 when the
  bracket is ACTIVE; approve flips PENDING→ACTIVE (and 409 on a second approve);
  admin read returns a PENDING bracket; 404s for unknown season/bracket; 401/403
  for no-token / league-admin.
- **`tests/api/test_bracket.py`** (public): 404 while PENDING or absent; after
  approval, returns rounds with enriched team refs (seed, league_name, owner)
  and null scores; a COMPLETE bracket is also visible.

## Files

- Create: `app/bracket/generation.py`, `app/api/admin/bracket.py`,
  `app/api/bracket.py`, `tests/bracket/test_generation.py`,
  `tests/api/admin/test_bracket.py`, `tests/api/test_bracket.py`.
- Modify: `app/api/admin/schemas.py`, `app/api/public_schemas.py`,
  `app/main.py` (mount the two routers).
- No model changes, no migration.

## Constraints

- All commands from `backend/`. Tests: `uv run pytest ...`. Postgres required
  (test DB `insight2redraft_test`).
- No new dependencies. No pagination. Every write path `db.commit()`.
- The generation service consumes the pure engine and stays the only DB-aware
  bracket logic in 4b; the engine is not modified.
- Admin-only detail never leaks into public responses; the public read never
  exposes a PENDING bracket.
- Known warning baseline: PyJWT `InsecureKeyLengthWarning`,
  `StarletteDeprecationWarning`. Anything new is a problem.
