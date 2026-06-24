# Cross-League Fantasy Football Platform — Design

**Date:** 2026-06-23
**Working title:** Insight2Redraft (TBD)
**Status:** Design approved; ready for implementation planning

## Summary

A "wrapper" web platform that sits on top of multiple independent Sleeper
fantasy football leagues and unifies them into a single season-long
competition. All leagues run as normal redraft leagues inside Sleeper using an
identical scoring system. The platform's novel contribution is a **cross-league
playoff super-bracket** that Sleeper cannot represent natively, plus a
**persistent owner history** (champions, records, movement) that spans leagues
and years.

Each league has its own separate player pool, so two playoff opponents may
roster identical players — this needs no special handling because each team is
scored independently.

## Goals

- Host an arbitrary number of Sleeper redraft leagues under one umbrella, all
  sharing one scoring system.
- After the regular season, pool qualifiers from every league into one
  single-elimination **super-bracket** that the platform runs itself.
- Maintain a complete, persistent **owner history**: champions, finishes,
  regular-season records, cross-league playoff stats, and league-of-origin /
  owner movement across years.
- Keep the competition fair via a hybrid scoring check that detects
  misconfigured leagues.

## Non-Goals (YAGNI for v1)

- Running league drafts, trades, or waivers (Sleeper handles all in-league
  play).
- Owner self-service logins / trash talk (public is read-only).
- Denormalized history tables (history is derived on read until proven slow).
- Magic-link auth (email+password to start; magic-link is an easy later swap).

## Core Concepts & Decisions

| Decision area | Choice |
|---|---|
| Playoff format | Pooled super-bracket across all leagues |
| Qualification | Top N per league (every league represented), then pooled global seeding |
| Seeding / tiebreak | Record, then points-for |
| Scoring source | Hybrid: store Sleeper's reported points AND an independent recompute; flag mismatches |
| Owner identity | Persistent platform Owner entity; Sleeper user IDs mapped to it (season-aware) |
| Access model | Public read; Super Admin (global); League Admin (Sleeper commish, league-scoped) |
| Tech stack | Python (FastAPI) backend, React + Vite frontend, Postgres, on Railway |
| Sync cadence | Near-live: poll every few minutes during NFL game windows, back off otherwise |
| Bracket mechanics | Single elimination, 1 NFL week per round, **reseeded every round** (high vs low original seed), admin finalizes after Monday night |
| Round tiebreaker | Most bench points; final fallback higher original seed |

## Roles & Access

- **Super Admin** — platform-wide. Create/edit seasons & leagues, run the
  scoring-validation review, resolve scoring mismatches, manage owner identity &
  mappings, generate/approve the bracket, finalize rounds, trigger manual sync,
  and **grant/revoke Super Admin to others** (initially the project owner).
- **League Admin** — a league's Sleeper commissioner, granted by default
  (commish status detected from Sleeper). Scoped to their league(s): manage
  their league's owner mappings, trigger a per-league sync, edit league-level
  info, view their scoring-validation status. Cannot touch the bracket or other
  leagues.
- **Public** — read-only, no login required.

Enforced server-side on every admin endpoint via account `role` plus a
per-league grant table.

## Architecture

Three deployable services on Railway:

1. **API service (FastAPI)** — REST API for the React frontend (public read
   endpoints + authenticated, role-aware admin endpoints). Stateless; reads/writes
   Postgres. Never calls Sleeper live — only reads synced data.

2. **Sync worker (long-running Python service)** — owns ALL Sleeper
   communication. NFL game-window aware: polls every few minutes during
   Thu/Sun/Mon game windows, backs off to a few times daily otherwise.
   Responsibilities: pull league config/users/rosters/weekly matchups; run hybrid
   scoring (store Sleeper points + recomputed points, flag mismatches); write to
   Postgres.

3. **Frontend (React + Vite)** — static SPA. Public read-only views plus a
   login-gated, role-aware admin area.

**Datastore:** Postgres (Railway add-on), SQLAlchemy + Alembic migrations.

**External dependency:** Sleeper's free public read API (no auth/key). The big
`players/nfl` dump is cached daily. The worker is a polite consumer
(rate-limited, with backoff).

**Source-of-truth split:** Sleeper owns lineups and raw results; our DB owns
cross-league structure (super-bracket, owner identity, history) — the things
Sleeper cannot represent.

### Component Boundaries (each independently testable)

- `sleeper_client` — thin Sleeper API wrapper (fetch + cache, no business logic).
- `scoring_engine` — pure function `(stats + ruleset) -> points`.
- `sync_service` — orchestrates client → engine → DB; owns scheduling/windows.
- `bracket_engine` — pure logic: seeding, reseeded matchup generation, advancement.
- `api` — FastAPI routers (public read + admin), auth/role enforcement.
- `history` — aggregation queries for owner profiles & hall of fame.

## Data Model (Postgres)

### Identity & accounts

- **`owner`** — persistent person. `id`, `first_name`, `last_name`, `email`,
  `display_name`, `avatar_url`, `notes`, `created_at`. Spine of all history.
- **`owner_sleeper_link`** — `owner_id`, `sleeper_user_id`,
  `sleeper_display_name`, `season` (season-aware; one owner → many Sleeper IDs
  over time).
- **`account`** — login credentials for admins only. `id`, `email`,
  `password_hash`, `role` (`super_admin` | `league_admin`), optional `owner_id`.
- **`league_admin_grant`** — `account_id`, `league_id` (scopes a League Admin).

### Competition structure

- **`season`** — `id`, `year`, `status` (setup/regular/playoffs/complete),
  `scoring_ruleset_id`, `playoff_field_per_league` (top-N), `nfl_playoff_weeks`.
- **`scoring_ruleset`** — versioned platform scoring rules used by the recompute
  engine.
- **`league`** — `id`, `season_id`, `sleeper_league_id`, `name`,
  `commish_sleeper_id`, `scoring_validated` (bool). Stores the Sleeper league ID
  per year.
- **`team`** — a roster within a league-season. `id`, `league_id`,
  `sleeper_roster_id`, `owner_id`, `sleeper_user_id`, `wins`, `losses`, `ties`,
  `points_for`, `points_against`, `league_finish`.

### Scoring & results

- **`weekly_score`** — per team per NFL week: `team_id`, `week`,
  `sleeper_points`, `recomputed_points`, `bench_points`, `mismatch_flag`,
  `is_final`.
- **`player`** / **`player_stat_cache`** — cached Sleeper player data + weekly
  stats feeding the recompute.

### Super-bracket

- **`bracket`** — one per season: `season_id`, `size`, `status`.
- **`bracket_seed`** — `bracket_id`, `team_id`, `seed` (original 1..N,
  referenced by reseeding all the way through), `qualified_via`.
- **`bracket_matchup`** — `bracket_id`, `round`, `nfl_week`, `team_a_id`,
  `team_b_id`, `team_a_score`, `team_b_score`, `winner_team_id`, `is_finalized`,
  `bye`. Populated round-by-round (dynamic reseeding), not as a static tree.

### History

Derived on read from the above (champions = finalized final matchups; owner
movement = team→league→season joins). No denormalized history tables in v1; add
materialized summaries later only if queries get heavy.

## Key Flows

### 1. Annual season setup (mostly manual, Super Admin)

1. Super Admin creates a `season`, picks the scoring ruleset, sets top-N per
   league and the NFL playoff weeks.
2. Admin creates the Sleeper leagues by hand in Sleeper (API can't), then enters
   each `sleeper_league_id` into the site.
3. On entry, the worker pulls league config and runs a **scoring-validation
   check** comparing each league's Sleeper scoring settings against the platform
   ruleset → sets `scoring_validated`, surfaces diffs to the admin.
4. Worker pulls users + rosters → creates `team` rows. Admin (or the league's
   commish) maps each Sleeper user to an owner (reuse or create). Commish status
   from Sleeper auto-grants League Admin.

### 2. In-season sync (worker, game-window aware)

- Pulls rosters (live W/L, points-for) and weekly matchups.
- For each team/week records `sleeper_points` and `recomputed_points` from the
  stat feed; computes `bench_points = sum(non-starter player points)`; sets
  `mismatch_flag` when Sleeper vs recompute diverge beyond a tolerance.
- Thu/Sun/Mon game windows: poll every few minutes. Otherwise: a few times
  daily. Windows derived from Sleeper state + an NFL game-window calendar.

### 3. Seeding & bracket creation (end of regular season)

- When a season flips to `playoffs`, take each league's top-N by record then
  points-for, pool all qualifiers, seed globally (record, then points-for), and
  build the single-elim bracket (byes for top seeds if field isn't a power of
  two).
- Super Admin reviews/approves the generated bracket before it goes live.

### 4. Round advancement (admin-finalized, reseeded)

- Each round = one NFL week. Worker keeps matchup scores live during games.
- After Monday night, Super Admin clicks **"Finalize round"**: locks
  `weekly_score.is_final`, decides each matchup by higher weekly (starter)
  points, with **most bench points** as tiebreaker and higher original seed as
  final fallback.
- Surviving teams are **re-seeded by original seed**; the next round's pairings
  regenerate high-vs-low (1 vs lowest, 2 vs 2nd-lowest, …). Byes for top
  remaining seeds when the field isn't a power of two. `bracket_engine` runs as a
  pure function: `(remaining teams + original seeds) -> next round pairings`.
- Finalizing after Monday night sidesteps Tue/Wed stat corrections.

### 5. History aggregation

Derived on read from finalized data: champions, runner-ups, finishes,
season-by-season records, playoff head-to-head, best weekly scores, league
movement.

## Frontend

### Public pages (read-only)

- **Home / Season dashboard** — season status, standings at a glance, live
  bracket during playoffs.
- **Super-bracket view** — visual bracket; live scores during game windows,
  reseeded pairings each round, byes shown. The playoff centerpiece.
- **Leagues** — per-league standings, rosters, owner-of-record.
- **Owner profile** — full history: championships, finishes, season-by-season
  records, league-of-origin/movement, playoff head-to-head, best weekly scores.
- **Hall of Fame / Records** — all-time champions, runner-ups, leaderboards
  (most titles, highest playoff week, biggest upset, etc.).

### Admin area (login-gated, role-aware)

- **Super Admin:** season setup; league entry + scoring-validation review;
  scoring-mismatch resolution queue; owner identity management & Sleeper mapping;
  bracket generation/approval; finalize round; promote/revoke Super Admins;
  manual "sync now".
- **League Admin:** their league's owner mapping; per-league "sync now"; their
  league's scoring-validation status.

### Auth

Lightweight, admin accounts only (email + password to start; magic-link an easy
later swap). Role + per-league grants enforced server-side on every admin
endpoint. Public needs no auth.

## Testing Strategy

Test-driven throughout, especially the two pure engines.

- **`scoring_engine`** — unit tests, fixture stat lines → expected points (the
  fairness guarantee; high coverage).
- **`bracket_engine`** — unit tests for seeding, high-low reseeding, byes, and
  the bench-points tiebreaker across odd field sizes. Pure logic.
- **`sleeper_client`** — tested against recorded Sleeper API fixtures (no live
  calls in tests).
- **`sync_service`** — integration tests with a fake client + temp DB; verifies
  hybrid scoring records both values and flags mismatches.
- **`api`** — endpoint tests for role enforcement (public can't hit admin
  routes; league admin can't touch other leagues or the bracket) and read
  correctness.
- **History aggregation** — tests over a seeded multi-season DB asserting
  champions/records/movement compute correctly.

## Open Items (defer to planning/build)

- Exact scoring ruleset values (TBD by the league group).
- Final list of Super-Admin-only vs League-Admin actions (split is baked in;
  specifics can firm up during build).
- Platform name.
- NFL game-window calendar source/format for the worker scheduler.
