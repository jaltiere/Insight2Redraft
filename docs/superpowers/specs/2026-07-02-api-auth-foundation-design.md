# Auth Foundation (API-1) — Design

## Summary

API-1 is the authentication and authorization foundation for the Insight2Redraft
API: password hashing, JWT-based login, a `get_current_account` dependency, and
role + per-league-grant enforcement dependencies, plus a CLI to bootstrap the
first Super Admin. It ships only the auth machinery and two proving endpoints
(`/auth/login`, `/auth/me`); the public read endpoints (API-2) and admin actions
(API-3) build on this slice.

This is the first slice of a decomposed API layer:
- **API-1 (this)** — auth foundation.
- **API-2** — public read endpoints (seasons/standings, leagues/rosters, owner
  profiles, hall of fame).
- **API-3** — admin actions (season/league CRUD, league entry → `sync_league_setup`,
  "sync now", owner mapping, scoring-validation review, mismatch queue).
- **Bracket** — separate track (pure `bracket_engine` + endpoints).

## Goals

- Store and verify admin passwords securely (Argon2).
- Issue and verify stateless JWT access tokens.
- Provide FastAPI dependencies that enforce authentication, the Super Admin role,
  and per-league League Admin scoping — server-side, on every protected endpoint.
- Bootstrap the first Super Admin without a public signup.
- Prove the stack end-to-end with `/auth/login` + `/auth/me`.

## Non-Goals (later slices)

- Public read endpoints (API-2) and admin action endpoints (API-3).
- League Admin account provisioning / invite / set-password flow (API-3).
- Token refresh / rotation / server-side revocation (stateless access token only;
  revisit if needed).
- Password reset, email verification, rate limiting, account lockout.
- The bracket engine and its endpoints.

## Decisions

- **Session mechanism:** stateless **JWT bearer tokens** (no server session
  store). Simple, standard for the React/Vite SPA, trivial to test. Revocation
  before expiry is out of scope (small admin set; modest expiry mitigates).
- **Password hashing:** `pwdlib` with **Argon2** (FastAPI's current recommended
  library; OWASP-preferred algorithm).
- **JWT library:** **PyJWT**, HS256, signed with `settings.jwt_secret`.
- **First Super Admin bootstrap:** a **CLI command** (`python -m app.cli
  create-superadmin`), run once against the DB. No lingering secret in the
  environment; doubles as a break-glass tool.

## Architecture & Module Structure

New `app/api/` package plus a top-level CLI module:

- `app/api/__init__.py`
- `app/api/security.py` — pure primitives: password hashing + JWT encode/decode.
  No FastAPI, no DB imports. Independently unit-testable.
- `app/api/schemas.py` — Pydantic request/response models.
- `app/api/deps.py` — FastAPI dependencies: reuse `app.db.get_db`;
  `get_current_account`; `require_super_admin`; `require_league_admin(league_id)`.
- `app/api/auth.py` — the `/auth` `APIRouter` (`login`, `me`).
- `app/cli.py` — `create-superadmin` command.
- `app/main.py` — `create_app()` includes the auth router.

Dependency direction: `deps.py`/`auth.py` depend on `security.py`, `schemas.py`,
`app.db`, `app.models`; `security.py` depends only on `pwdlib`, `PyJWT`,
`app.config`, and `AccountRole`. Nothing depends on the API package.

## Security Primitives (`security.py`)

- `hash_password(plain: str) -> str` and `verify_password(plain: str, hashed:
  str) -> bool`, backed by a module-level pwdlib `PasswordHash` configured for
  Argon2.
- `create_access_token(account_id: int, role: AccountRole) -> str` — PyJWT
  `encode`, HS256, `settings.jwt_secret`, claims: `sub` (str of account id),
  `role` (the enum `.value`, e.g. `super_admin`), `iat`, `exp` (now +
  `settings.access_token_expire_minutes`).
- `decode_access_token(token: str) -> dict` — PyJWT `decode`; on any
  `PyJWTError` (invalid signature, malformed, expired) raise a typed
  `InvalidToken` error the dependency layer maps to HTTP 401.

## Config Additions (`app/config.py`)

- `jwt_secret: str = "dev-insecure-change-me"` — a development default; **must**
  be overridden via the `JWT_SECRET` env var in any real deployment.
- `access_token_expire_minutes: float = 720.0` (12 hours).

## Auth Dependencies (`deps.py`)

- Reuse `app.db.get_db` for a request-scoped `Session`.
- `bearer_scheme = HTTPBearer(auto_error=False)`.
- `get_current_account(credentials = Depends(bearer_scheme), db = Depends(get_db))
  -> Account` — if credentials are absent, raise **401**; decode the token
  (401 on `InvalidToken`); load `Account` by `int(sub)`; raise **401** if the
  account no longer exists. Return the `Account`.
- `require_super_admin(account = Depends(get_current_account)) -> Account` —
  return the account if `role is AccountRole.SUPER_ADMIN`, else **403**.
- `require_league_admin(league_id: int)` — a dependency **factory** returning a
  dependency callable: given the current account, allow a `SUPER_ADMIN`
  unconditionally; allow a `LEAGUE_ADMIN` only if a `LeagueAdminGrant` row exists
  for `(account_id, league_id)`; otherwise **403**. Returns the `Account`.

All auth failures use a generic message and the `WWW-Authenticate: Bearer`
header where appropriate; login failures do not distinguish unknown-email from
bad-password (no user enumeration).

## Endpoints (`auth.py`, router prefix `/auth`)

- `POST /auth/login` — body `LoginRequest {email: str, password: str}`. Look up
  the `Account` by email; if found and `verify_password` succeeds, return **200**
  `TokenResponse {access_token, token_type: "bearer"}`. Otherwise **401** with a
  single generic "invalid credentials" message.
- `GET /auth/me` — requires `get_current_account`; returns `AccountResponse {id,
  email, role, owner_id}`.
- `GET /health` remains public and unchanged.

### Schemas (`schemas.py`)

- `LoginRequest` — `email: str`, `password: str`.
- `TokenResponse` — `access_token: str`, `token_type: str = "bearer"`.
- `AccountResponse` — `id: int`, `email: str`, `role: AccountRole`, `owner_id:
  int | None`. `model_config = ConfigDict(from_attributes=True)`.

## CLI Bootstrap (`app/cli.py`)

`python -m app.cli create-superadmin --email <e> --password <p>`:

- Parse args with `argparse`.
- Open a `SessionLocal`; look up an `Account` by email.
- If absent: create it with `role=super_admin` and `hash_password(password)`;
  print "created".
- If present: update its `password_hash` and set `role=super_admin`; print
  "updated". (Idempotent, and a break-glass password reset.)
- Commit and close.

## Error Semantics

- Missing/invalid/expired token on a protected route → **401**.
- Authenticated but wrong role / missing league grant → **403**.
- Bad login credentials → **401**, generic message.
- Validation errors (malformed body) → FastAPI's default **422**.

## Testing Strategy

FastAPI `TestClient` with `app.dependency_overrides[get_db]` pointed at the
rolled-back `db_session` fixture (Postgres via the existing test DB). No live
network.

- `security.py` (pure unit): `hash_password`/`verify_password` true and false;
  `create_access_token` → `decode_access_token` round-trip yields the right
  `sub`/`role`; a tampered token and an expired token both raise `InvalidToken`.
- `POST /auth/login`: success returns a usable token; wrong password → 401;
  unknown email → 401 (identical message).
- `GET /auth/me`: valid token → the account; no token → 401; garbage token → 401.
- `require_super_admin`: super admin passes; league admin → 403.
- `require_league_admin(league_id)`: granted league admin passes; ungranted
  league admin → 403; super admin passes for any league. (Exercised via a tiny
  throwaway route mounted in the test, or by calling the dependency directly with
  a seeded account + grant.)
- CLI: `create-superadmin` creates an account (role super_admin, password
  verifies); a second call with a new password updates it (still one row, new
  password verifies).

## Open Items (later slices)

- League Admin account provisioning (invite / set-password) — API-3.
- Token refresh/revocation — revisit only if the admin set or threat model grows.
- Rate limiting / lockout on `/auth/login` — revisit with production hardening.
