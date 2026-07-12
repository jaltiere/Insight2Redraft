# Auth Foundation (API-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Password hashing, JWT login, and role/league-grant enforcement dependencies for the Insight2Redraft API, proven end-to-end by `POST /auth/login` + `GET /auth/me`, plus a `create-superadmin` CLI.

**Architecture:** A new `app/api/` package layered on the existing models/db: `security.py` holds pure primitives (Argon2 via pwdlib, HS256 JWTs via PyJWT — no FastAPI, no DB session usage), `deps.py` holds FastAPI dependencies (`get_current_account`, `require_super_admin`, `require_league_admin`), `auth.py` is the `/auth` router wired into `create_app()`. `app/cli.py` bootstraps the first Super Admin. No schema changes — `Account`, `AccountRole`, `LeagueAdminGrant` already exist.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, `pwdlib[argon2]`, `PyJWT`, pytest + FastAPI `TestClient`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-api-auth-foundation-design.md`. Deviations need sign-off.
- All commands run from `backend/`. Tests: `uv run pytest ...`.
- Postgres REQUIRED for tests — container `Insight2Redraft` on localhost:5432 (test DB `insight2redraft_test`).
- JWT: **HS256**, signed with `settings.jwt_secret`; claims exactly `sub` (str of account id), `role` (enum `.value`, e.g. `super_admin`), `iat`, `exp`.
- Config names exactly: `jwt_secret` (default `"dev-insecure-change-me"`, env `JWT_SECRET`), `access_token_expire_minutes: float = 720.0`.
- Auth failures: missing/invalid/expired token → **401** with `WWW-Authenticate: Bearer` header; wrong role / missing grant → **403**; bad login → **401** with a single generic message (unknown-email and wrong-password responses must be byte-identical — no user enumeration).
- `security.py` must not import FastAPI or `app.db` — only `pwdlib`, `jwt`, `app.config`, and `AccountRole`.
- New runtime deps: `pwdlib[argon2]`, `pyjwt` — added via `uv add` (Task 1). No other new dependencies.
- Do NOT touch the existing `/health` endpoint behavior — it stays public.

## File Structure

- Create: `app/api/__init__.py` (empty), `app/api/security.py`, `app/api/schemas.py`, `app/api/deps.py`, `app/api/auth.py`, `app/cli.py`
- Modify: `app/config.py` (2 settings), `app/main.py` (include router), `.env.example`, `pyproject.toml` (via `uv add`)
- Tests: `tests/api/__init__.py`, `tests/api/conftest.py`, `tests/api/test_security.py`, `tests/api/test_auth.py`, `tests/api/test_deps.py`, `tests/test_cli.py`

---

### Task 1: Security primitives + config

**Files:**
- Modify: `backend/pyproject.toml` (via `uv add`, not by hand)
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/security.py`
- Test: `backend/tests/api/__init__.py`, `backend/tests/api/test_security.py`

**Interfaces:**
- Consumes: `app.config.settings`, `app.models.identity.AccountRole`
- Produces (later tasks import these from `app.api.security`):
  - `hash_password(plain: str) -> str`
  - `verify_password(plain: str, hashed: str) -> bool`
  - `create_access_token(account_id: int, role: AccountRole) -> str`
  - `decode_access_token(token: str) -> dict` — raises `InvalidToken` on any bad token
  - `class InvalidToken(Exception)`
  - New settings: `settings.jwt_secret: str`, `settings.access_token_expire_minutes: float`

- [ ] **Step 1: Add dependencies**

```bash
cd backend && uv add "pwdlib[argon2]" pyjwt
```

Expected: `pyproject.toml` gains `pwdlib[argon2]>=...` and `pyjwt>=...` under `dependencies`; `uv.lock` updated.

- [ ] **Step 2: Add config settings and env example entries**

In `backend/app/config.py`, add two fields to `Settings` after `worker_players_sync_hours`:

```python
    worker_players_sync_hours: float = 24.0
    jwt_secret: str = "dev-insecure-change-me"
    access_token_expire_minutes: float = 720.0
```

Append to `backend/.env.example`:

```
# Auth — MUST override JWT_SECRET in any real deployment
JWT_SECRET=dev-insecure-change-me
ACCESS_TOKEN_EXPIRE_MINUTES=720
```

- [ ] **Step 3: Write the failing tests**

Create empty `backend/app/api/__init__.py` and empty `backend/tests/api/__init__.py`.

Create `backend/tests/api/test_security.py`:

```python
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.api.security import (
    InvalidToken,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.config import settings
from app.models import AccountRole


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("s3cret!")
    assert hashed != "s3cret!"
    assert verify_password("s3cret!", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("s3cret!")
    assert verify_password("wrong", hashed) is False


def test_access_token_roundtrip_carries_sub_and_role():
    token = create_access_token(42, AccountRole.SUPER_ADMIN)
    claims = decode_access_token(token)
    assert claims["sub"] == "42"
    assert claims["role"] == "super_admin"
    assert claims["exp"] > claims["iat"]


def test_decode_rejects_token_signed_with_wrong_secret():
    now = datetime.now(UTC)
    forged = jwt.encode(
        {"sub": "1", "role": "super_admin", "iat": now, "exp": now + timedelta(hours=1)},
        "not-the-real-secret",
        algorithm="HS256",
    )
    with pytest.raises(InvalidToken):
        decode_access_token(forged)


def test_decode_rejects_expired_token():
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": "1",
            "role": "super_admin",
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(InvalidToken):
        decode_access_token(expired)


def test_decode_rejects_malformed_token():
    with pytest.raises(InvalidToken):
        decode_access_token("not-a-jwt")
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_security.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.security'`

- [ ] **Step 5: Implement `security.py`**

Create `backend/app/api/security.py`:

```python
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import settings
from app.models.identity import AccountRole

_ALGORITHM = "HS256"

_password_hash = PasswordHash((Argon2Hasher(),))


class InvalidToken(Exception):
    """Raised when a JWT is malformed, tampered with, or expired."""


def hash_password(plain: str) -> str:
    return _password_hash.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _password_hash.verify(plain, hashed)


def create_access_token(account_id: int, role: AccountRole) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(account_id),
        "role": role.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise InvalidToken(str(exc)) from exc
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_security.py -v`
Expected: 6 passed

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock app/config.py .env.example app/api/ tests/api/
git commit -m "feat: add auth security primitives (Argon2 hashing + HS256 JWT)"
```

---

### Task 2: Schemas + `/auth/login` endpoint

**Files:**
- Create: `backend/app/api/schemas.py`
- Create: `backend/app/api/auth.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/conftest.py`, `backend/tests/api/test_auth.py`

**Interfaces:**
- Consumes: `app.api.security.hash_password/verify_password/create_access_token/decode_access_token`; `app.db.get_db`; `app.models.Account`
- Produces:
  - `app.api.schemas.LoginRequest {email: str, password: str}`, `TokenResponse {access_token: str, token_type: str = "bearer"}`, `AccountResponse {id: int, email: str, role: AccountRole, owner_id: int | None}` (with `from_attributes=True`)
  - `app.api.auth.router` — `APIRouter(prefix="/auth")`, mounted in `create_app()`
  - Test fixtures in `tests/api/conftest.py` used by Tasks 3–4: `app` (FastAPI app with `get_db` overridden), `client` (`TestClient`), `make_account(email, password, role=AccountRole.SUPER_ADMIN, owner_id=None) -> Account`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.api.security import hash_password
from app.db import get_db
from app.main import create_app
from app.models import Account, AccountRole


@pytest.fixture()
def app(db_session):
    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    return application


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def make_account(db_session):
    def _make(
        email: str,
        password: str,
        role: AccountRole = AccountRole.SUPER_ADMIN,
        owner_id: int | None = None,
    ) -> Account:
        account = Account(
            email=email,
            password_hash=hash_password(password),
            role=role,
            owner_id=owner_id,
        )
        db_session.add(account)
        db_session.flush()
        return account

    return _make
```

Create `backend/tests/api/test_auth.py`:

```python
from app.api.security import decode_access_token


def test_login_success_returns_usable_token(client, make_account):
    make_account("admin@example.com", "correct-horse")
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "correct-horse"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    claims = decode_access_token(body["access_token"])
    assert claims["role"] == "super_admin"


def test_login_wrong_password_returns_401(client, make_account):
    make_account("admin@example.com", "correct-horse")
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_login_unknown_email_indistinguishable_from_wrong_password(client, make_account):
    make_account("admin@example.com", "correct-horse")
    wrong_pw = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )
    unknown = client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )
    assert unknown.status_code == 401
    assert unknown.json() == wrong_pw.json()


def test_health_stays_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_auth.py -v`
Expected: the three login tests FAIL with 404 (no `/auth/login` route mounted yet); `test_health_stays_public` passes.

- [ ] **Step 3: Implement schemas, router, and wiring**

Create `backend/app/api/schemas.py`:

```python
from pydantic import BaseModel, ConfigDict

from app.models.identity import AccountRole


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: AccountRole
    owner_id: int | None
```

Create `backend/app/api/auth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import LoginRequest, TokenResponse
from app.api.security import create_access_token, verify_password
from app.db import get_db
from app.models import Account

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    account = db.execute(
        select(Account).where(Account.email == body.email)
    ).scalar_one_or_none()
    if account is None or not verify_password(body.password, account.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenResponse(access_token=create_access_token(account.id, account.role))
```

Replace the full contents of `backend/app/main.py`:

```python
from fastapi import FastAPI

from app.api.auth import router as auth_router


def create_app() -> FastAPI:
    app = FastAPI(title="Insight2Redraft API")
    app.include_router(auth_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_auth.py tests/test_health.py -v`
Expected: 5 passed (4 new + existing health test)

- [ ] **Step 5: Commit**

```bash
git add app/api/schemas.py app/api/auth.py app/main.py tests/api/conftest.py tests/api/test_auth.py
git commit -m "feat: add /auth/login with generic 401 on bad credentials"
```

---

### Task 3: `get_current_account` dependency + `/auth/me`

**Files:**
- Create: `backend/app/api/deps.py`
- Modify: `backend/app/api/auth.py` (add `/me`)
- Test: `backend/tests/api/test_auth.py` (append)

**Interfaces:**
- Consumes: `app.api.security.decode_access_token`/`InvalidToken`/`create_access_token`; `app.db.get_db`; `app.models.Account`; fixtures `client`, `make_account` from Task 2
- Produces (Task 4 builds on these from `app.api.deps`):
  - `bearer_scheme = HTTPBearer(auto_error=False)`
  - `get_current_account(credentials, db) -> Account` — FastAPI dependency, raises 401 (`WWW-Authenticate: Bearer`) on missing/invalid token or vanished account

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/test_auth.py`:

```python
from app.api.security import create_access_token


def _auth_header(account) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def test_me_returns_current_account(client, make_account):
    account = make_account("admin@example.com", "correct-horse")
    resp = client.get("/auth/me", headers=_auth_header(account))
    assert resp.status_code == 200
    assert resp.json() == {
        "id": account.id,
        "email": "admin@example.com",
        "role": "super_admin",
        "owner_id": None,
    }


def test_me_without_token_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"] == "Bearer"


def test_me_with_garbage_token_returns_401(client):
    resp = client.get("/auth/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_me_with_token_for_deleted_account_returns_401(client, make_account, db_session):
    account = make_account("ghost@example.com", "pw")
    headers = _auth_header(account)
    db_session.delete(account)
    db_session.flush()
    resp = client.get("/auth/me", headers=headers)
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_auth.py -v`
Expected: the 4 new `test_me_*` tests FAIL with 404 (no `/auth/me` route); the 4 existing tests still pass.

- [ ] **Step 3: Implement `deps.py` and the `/me` route**

Create `backend/app/api/deps.py`:

```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.security import InvalidToken, decode_access_token
from app.db import get_db
from app.models import Account

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Account:
    if credentials is None:
        raise _unauthorized()
    try:
        claims = decode_access_token(credentials.credentials)
        account_id = int(claims["sub"])
    except (InvalidToken, KeyError, ValueError):
        raise _unauthorized()
    account = db.get(Account, account_id)
    if account is None:
        raise _unauthorized()
    return account
```

In `backend/app/api/auth.py`, extend the imports and add the route:

```python
from app.api.deps import get_current_account
from app.api.schemas import AccountResponse, LoginRequest, TokenResponse
from app.models import Account
```

(merge with the existing imports — final import block of `auth.py`:)

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_account
from app.api.schemas import AccountResponse, LoginRequest, TokenResponse
from app.api.security import create_access_token, verify_password
from app.db import get_db
from app.models import Account
```

Append after `login`:

```python
@router.get("/me", response_model=AccountResponse)
def me(account: Account = Depends(get_current_account)) -> Account:
    return account
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/ -v`
Expected: 14 passed (6 security + 8 auth)

- [ ] **Step 5: Commit**

```bash
git add app/api/deps.py app/api/auth.py tests/api/test_auth.py
git commit -m "feat: add get_current_account dependency + /auth/me"
```

---

### Task 4: Role enforcement — `require_super_admin` + `require_league_admin`

**Files:**
- Modify: `backend/app/api/deps.py` (append two dependencies)
- Test: `backend/tests/api/test_deps.py`

**Interfaces:**
- Consumes: `get_current_account`, `get_db`, `app.models.{Account, AccountRole, LeagueAdminGrant, League, Season}`; fixtures `app`, `make_account` from Task 2
- Produces (API-3 endpoints will use these from `app.api.deps`):
  - `require_super_admin(account = Depends(get_current_account)) -> Account` — 403 unless `SUPER_ADMIN`
  - `require_league_admin(league_id: int)` — factory returning a dependency callable `(account = Depends(get_current_account), db = Depends(get_db)) -> Account`; SUPER_ADMIN always passes, LEAGUE_ADMIN passes only with a `LeagueAdminGrant` row for `(account_id, league_id)`, else 403

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_deps.py`:

```python
import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient

from app.api.deps import require_league_admin, require_super_admin
from app.api.security import create_access_token
from app.models import Account, AccountRole, League, LeagueAdminGrant, Season


@pytest.fixture()
def league(db_session):
    season = Season(year=2099)
    db_session.add(season)
    db_session.flush()
    lg = League(season_id=season.id, sleeper_league_id="999", name="Grant Test League")
    db_session.add(lg)
    db_session.flush()
    return lg


def _auth_header(account) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


# require_super_admin — direct calls

def test_require_super_admin_passes_super_admin(make_account):
    account = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    assert require_super_admin(account=account) is account


def test_require_super_admin_rejects_league_admin_with_403(make_account):
    account = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    with pytest.raises(HTTPException) as exc:
        require_super_admin(account=account)
    assert exc.value.status_code == 403


# require_super_admin — wired through a real route end-to-end

def test_require_super_admin_route_enforcement(app, make_account):
    @app.get("/_test/super-only")
    def super_only(account: Account = Depends(require_super_admin)) -> dict[str, int]:
        return {"id": account.id}

    client = TestClient(app)
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)

    ok = client.get("/_test/super-only", headers=_auth_header(root))
    assert ok.status_code == 200
    assert ok.json() == {"id": root.id}

    forbidden = client.get("/_test/super-only", headers=_auth_header(la))
    assert forbidden.status_code == 403


# require_league_admin — direct calls on the factory's dependency

def test_league_admin_with_grant_passes(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=admin.id, league_id=league.id))
    db_session.flush()
    dep = require_league_admin(league.id)
    assert dep(account=admin, db=db_session) is admin


def test_league_admin_without_grant_rejected_403(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    dep = require_league_admin(league.id)
    with pytest.raises(HTTPException) as exc:
        dep(account=admin, db=db_session)
    assert exc.value.status_code == 403


def test_super_admin_passes_any_league_without_grant(db_session, make_account, league):
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    dep = require_league_admin(league.id)
    assert dep(account=root, db=db_session) is root
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_deps.py -v`
Expected: FAIL — `ImportError: cannot import name 'require_league_admin' from 'app.api.deps'`

- [ ] **Step 3: Implement the role dependencies**

Append to `backend/app/api/deps.py` (and add to its imports: `from collections.abc import Callable`, `from sqlalchemy import select`, and extend the models import to `from app.models import Account, AccountRole, LeagueAdminGrant`):

```python
def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="Forbidden")


def require_super_admin(account: Account = Depends(get_current_account)) -> Account:
    if account.role is not AccountRole.SUPER_ADMIN:
        raise _forbidden()
    return account


def require_league_admin(league_id: int) -> Callable[..., Account]:
    def dependency(
        account: Account = Depends(get_current_account),
        db: Session = Depends(get_db),
    ) -> Account:
        if account.role is AccountRole.SUPER_ADMIN:
            return account
        grant = db.execute(
            select(LeagueAdminGrant).where(
                LeagueAdminGrant.account_id == account.id,
                LeagueAdminGrant.league_id == league_id,
            )
        ).scalar_one_or_none()
        if grant is None:
            raise _forbidden()
        return account

    return dependency
```

Final import block of `deps.py` after this task:

```python
from collections.abc import Callable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.security import InvalidToken, decode_access_token
from app.db import get_db
from app.models import Account, AccountRole, LeagueAdminGrant
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/ -v`
Expected: 20 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/deps.py tests/api/test_deps.py
git commit -m "feat: add require_super_admin + require_league_admin dependencies"
```

---

### Task 5: `create-superadmin` CLI + full-suite verification

**Files:**
- Create: `backend/app/cli.py`
- Test: `backend/tests/test_cli.py`

**Interfaces:**
- Consumes: `app.api.security.hash_password`, `app.db.SessionLocal`, `app.models.{Account, AccountRole}`
- Produces:
  - `python -m app.cli create-superadmin --email <e> --password <p>` — prints `created` or `updated`
  - `app.cli.main(argv: list[str] | None = None, session_factory: Callable[[], Session] = SessionLocal) -> None` (the `session_factory` parameter exists so tests can inject the rolled-back `db_session`)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_cli.py`:

```python
from sqlalchemy import select

from app.api.security import verify_password
from app.cli import main
from app.models import Account, AccountRole


def test_create_superadmin_creates_account(db_session, capsys):
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "first-pw"],
        session_factory=lambda: db_session,
    )
    assert capsys.readouterr().out.strip() == "created"

    account = db_session.execute(
        select(Account).where(Account.email == "root@example.com")
    ).scalar_one()
    assert account.role is AccountRole.SUPER_ADMIN
    assert verify_password("first-pw", account.password_hash)


def test_create_superadmin_second_call_updates_password(db_session, capsys):
    factory = lambda: db_session  # noqa: E731
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "first-pw"],
        session_factory=factory,
    )
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "second-pw"],
        session_factory=factory,
    )
    assert capsys.readouterr().out.strip().splitlines() == ["created", "updated"]

    accounts = db_session.execute(
        select(Account).where(Account.email == "root@example.com")
    ).scalars().all()
    assert len(accounts) == 1
    assert accounts[0].role is AccountRole.SUPER_ADMIN
    assert verify_password("second-pw", accounts[0].password_hash)
    assert not verify_password("first-pw", accounts[0].password_hash)
```

Note: `main` commits and closes the injected `db_session`. This is safe with the root-conftest fixture — the session is bound to a connection with an outer transaction, so `commit()` releases a savepoint (SQLAlchemy 2.0 `conditional_savepoint` join mode) and the fixture still rolls everything back; a closed session transparently re-opens on next use.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.cli'`

- [ ] **Step 3: Implement `app/cli.py`**

Create `backend/app/cli.py`:

```python
import argparse
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.security import hash_password
from app.db import SessionLocal
from app.models import Account, AccountRole


def create_superadmin(
    email: str,
    password: str,
    session_factory: Callable[[], Session] = SessionLocal,
) -> str:
    session = session_factory()
    try:
        account = session.execute(
            select(Account).where(Account.email == email)
        ).scalar_one_or_none()
        if account is None:
            session.add(
                Account(
                    email=email,
                    password_hash=hash_password(password),
                    role=AccountRole.SUPER_ADMIN,
                )
            )
            outcome = "created"
        else:
            account.password_hash = hash_password(password)
            account.role = AccountRole.SUPER_ADMIN
            outcome = "updated"
        session.commit()
        return outcome
    finally:
        session.close()


def main(
    argv: list[str] | None = None,
    session_factory: Callable[[], Session] = SessionLocal,
) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser(
        "create-superadmin", help="Create or reset the Super Admin account"
    )
    create.add_argument("--email", required=True)
    create.add_argument("--password", required=True)
    args = parser.parse_args(argv)

    if args.command == "create-superadmin":
        print(create_superadmin(args.email, args.password, session_factory))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_cli.py -v`
Expected: 2 passed

- [ ] **Step 5: Run the full suite**

Run: `uv run pytest`
Expected: 111 passed (89 pre-existing + 22 new), no new warnings beyond the pre-existing Starlette deprecation warning.

- [ ] **Step 6: Commit**

```bash
git add app/cli.py tests/test_cli.py
git commit -m "feat: add create-superadmin CLI bootstrap"
```

---

## Verification (whole branch)

- `uv run pytest` — full suite green.
- Manual smoke (optional, needs dev DB): `uv run python -m app.cli create-superadmin --email you@example.com --password test-pw`, then `uv run uvicorn app.main:app` and `curl -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"you@example.com","password":"test-pw"}'` → token; `curl localhost:8000/auth/me -H "Authorization: Bearer <token>"` → account JSON.
