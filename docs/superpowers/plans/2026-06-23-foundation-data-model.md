# Foundation & Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Python backend project with a Postgres data model (all platform tables), Alembic migrations, a health endpoint, and Railway-ready config — the foundation every later plan builds on.

**Architecture:** A FastAPI application backed by Postgres via SQLAlchemy 2.0 (sync ORM). Models are split by responsibility into focused modules (identity, competition, scoring, bracket). Alembic manages schema migrations. Tests run against a dedicated Postgres test database, creating/dropping tables per session.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.0, Alembic, psycopg 3, pydantic-settings, pytest, httpx. Dependency/venv management via `uv`. Deployed on Railway.

## Global Constraints

- Python `>=3.12`.
- SQLAlchemy 2.0 declarative style (`DeclarativeBase`, `Mapped`, `mapped_column`) — never the legacy `declarative_base()` / `Column` style.
- Database is Postgres only. Connection URL uses the `postgresql+psycopg://` driver prefix (psycopg 3).
- All dependency installs and command runs go through `uv` (`uv add`, `uv sync`, `uv run ...`). Never call `pip` directly.
- All backend code lives under `backend/`. The Python package is `app`. Tests live under `backend/tests/`.
- Every model module must be imported by `app/models/__init__.py` so its tables register on `Base.metadata`.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.
- Run commands from inside `backend/` unless stated otherwise.

---

## Prerequisite: Local Postgres

Before Task 1, ensure a local Postgres is running with the two databases this plan uses. Run once:

```bash
docker run --name i2r-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -p 5432:5432 -d postgres:16
sleep 5
docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft;"
docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft_test;"
```

(If you already have Postgres locally, just create databases `insight2redraft` and `insight2redraft_test` owned by a `postgres`/`postgres` role, or adjust the URLs in `.env`.)

---

## File Structure

```
backend/
  pyproject.toml          # project + deps (uv-managed)
  .env.example            # documents required env vars
  .env                    # local env (gitignored)
  .gitignore
  README.md               # how to run/test/deploy
  Procfile                # Railway start command
  railway.json            # Railway build/deploy + pre-deploy migration
  alembic.ini             # Alembic config
  alembic/
    env.py                # wired to app.models Base + settings
    versions/             # migration files
  app/
    __init__.py
    config.py             # Settings (pydantic-settings)
    db.py                 # engine, SessionLocal, get_db
    main.py               # FastAPI app factory + /health
    models/
      __init__.py         # imports all models, exports Base
      base.py             # Base (DeclarativeBase) + TimestampMixin
      identity.py         # Owner, OwnerSleeperLink, Account, LeagueAdminGrant, AccountRole
      competition.py      # Season, ScoringRuleset, League, Team, SeasonStatus
      scoring.py          # WeeklyScore, Player, PlayerStatCache
      bracket.py          # Bracket, BracketSeed, BracketMatchup, BracketStatus, QualifiedVia
  tests/
    __init__.py
    conftest.py           # engine + db_session fixtures
    test_health.py
    test_models_identity.py
    test_models_competition.py
    test_models_scoring.py
    test_models_bracket.py
    test_migrations.py
```

---

### Task 1: Project scaffolding + health endpoint

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/.env`
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py` (empty)
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces:
  - `app.config.settings` — a `Settings` instance with attrs `database_url: str` and `test_database_url: str`.
  - `app.db.engine` (SQLAlchemy `Engine`), `app.db.SessionLocal` (sessionmaker), `app.db.get_db()` (generator yielding a `Session`).
  - `app.main.app` — a FastAPI instance; `app.main.create_app() -> FastAPI`.

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "insight2redraft-backend"
version = "0.1.0"
description = "Cross-league fantasy football platform backend"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "psycopg[binary]>=3.2",
    "pydantic-settings>=2.3",
]

[dependency-groups]
dev = [
    "pytest>=8.2",
    "httpx>=0.27",
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]

[tool.setuptools.packages.find]
include = ["app*"]
```

- [ ] **Step 2: Create `backend/.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
.env
.pytest_cache/
.uv/
uv.lock
```

- [ ] **Step 3: Create `backend/.env.example`**

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft_test
```

- [ ] **Step 4: Create `backend/.env`** (same contents as `.env.example`)

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft_test
```

- [ ] **Step 5: Create empty `backend/app/__init__.py` and `backend/tests/__init__.py`**

Both files are empty.

- [ ] **Step 6: Create `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft"
    test_database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/insight2redraft_test"


settings = Settings()
```

- [ ] **Step 7: Create `backend/app/db.py`**

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 8: Create `backend/app/main.py`**

```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Insight2Redraft API")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 9: Install dependencies**

Run: `cd backend && uv sync`
Expected: a `.venv` is created and all dependencies (fastapi, sqlalchemy, etc.) install without error.

- [ ] **Step 10: Write the failing test `backend/tests/test_health.py`**

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `uv run pytest tests/test_health.py -v`
Expected: PASS (1 passed). The app factory and route already exist, so this confirms scaffolding works end to end.

- [ ] **Step 12: Commit**

```bash
git add backend/
git commit -m "feat: scaffold FastAPI backend with health endpoint"
```

---

### Task 2: Base model + identity tables

**Files:**
- Create: `backend/app/models/base.py`
- Create: `backend/app/models/identity.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_models_identity.py`

**Interfaces:**
- Produces:
  - `app.models.base.Base` — `DeclarativeBase` subclass; `app.models.base.TimestampMixin` (adds `created_at`, `updated_at`).
  - `app.models.identity.AccountRole` — `enum.Enum` with members `SUPER_ADMIN`, `LEAGUE_ADMIN`.
  - `Owner(id, first_name, last_name, email, display_name, avatar_url, notes, created_at, updated_at)`.
  - `OwnerSleeperLink(id, owner_id, sleeper_user_id, sleeper_display_name, season)`.
  - `Account(id, email, password_hash, role, owner_id, created_at, updated_at)`.
  - Test fixtures `engine` (session-scoped) and `db_session` (function-scoped, rolls back) in `conftest.py`.
- Note: `LeagueAdminGrant` is intentionally deferred to Task 3 because it has a foreign key to the `league` table, which Task 3 creates. Keeping it out of Task 2 means Task 2's `create_all` succeeds and its tests pass standalone.

- [ ] **Step 1: Create `backend/app/models/base.py`**

```python
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

- [ ] **Step 2: Create `backend/app/models/identity.py`**

```python
import enum

from sqlalchemy import Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AccountRole(enum.Enum):
    SUPER_ADMIN = "super_admin"
    LEAGUE_ADMIN = "league_admin"


# NOTE: LeagueAdminGrant is added to this module in Task 3 (it FKs the `league`
# table, which Task 3 creates).


class Owner(Base, TimestampMixin):
    __tablename__ = "owner"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(String)

    sleeper_links: Mapped[list["OwnerSleeperLink"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class OwnerSleeperLink(Base):
    __tablename__ = "owner_sleeper_link"
    __table_args__ = (
        UniqueConstraint("sleeper_user_id", "season", name="uq_sleeper_link_user_season"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owner.id", ondelete="CASCADE"))
    sleeper_user_id: Mapped[str] = mapped_column(String(50))
    sleeper_display_name: Mapped[str | None] = mapped_column(String(100))
    season: Mapped[int] = mapped_column(Integer)

    owner: Mapped["Owner"] = relationship(back_populates="sleeper_links")


class Account(Base, TimestampMixin):
    __tablename__ = "account"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AccountRole] = mapped_column(Enum(AccountRole, name="account_role"))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id", ondelete="SET NULL"))
```

(`LeagueAdminGrant` is added to this file in Task 3.)

- [ ] **Step 3: Create `backend/app/models/__init__.py`**

```python
from app.models.base import Base, TimestampMixin
from app.models.identity import (
    Account,
    AccountRole,
    Owner,
    OwnerSleeperLink,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "Account",
    "AccountRole",
    "Owner",
    "OwnerSleeperLink",
]
```

- [ ] **Step 4: Create `backend/tests/conftest.py`**

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  (registers all tables on Base.metadata)
from app.config import settings
from app.models.base import Base


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(settings.test_database_url, future=True)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    TestSession = sessionmaker(bind=connection, expire_on_commit=False)
    session: Session = TestSession()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
```

- [ ] **Step 5: Write the failing test `backend/tests/test_models_identity.py`**

```python
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Account, AccountRole, Owner, OwnerSleeperLink


def test_owner_with_sleeper_link_roundtrip(db_session):
    owner = Owner(first_name="Jane", last_name="Doe", email="jane@example.com")
    owner.sleeper_links.append(
        OwnerSleeperLink(sleeper_user_id="123", sleeper_display_name="jdoe", season=2026)
    )
    db_session.add(owner)
    db_session.commit()

    loaded = db_session.query(Owner).filter_by(email="jane@example.com").one()
    assert loaded.first_name == "Jane"
    assert loaded.created_at is not None
    assert len(loaded.sleeper_links) == 1
    assert loaded.sleeper_links[0].season == 2026


def test_account_role_enum_persists(db_session):
    account = Account(
        email="admin@example.com",
        password_hash="x",
        role=AccountRole.SUPER_ADMIN,
    )
    db_session.add(account)
    db_session.commit()

    loaded = db_session.query(Account).filter_by(email="admin@example.com").one()
    assert loaded.role is AccountRole.SUPER_ADMIN


def test_account_email_unique(db_session):
    db_session.add(Account(email="dup@example.com", password_hash="x", role=AccountRole.LEAGUE_ADMIN))
    db_session.commit()
    db_session.add(Account(email="dup@example.com", password_hash="y", role=AccountRole.LEAGUE_ADMIN))
    with pytest.raises(IntegrityError):
        db_session.commit()
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `uv run pytest tests/test_models_identity.py -v`
Expected: PASS (3 passed). All identity tables are FK-closed (Account/OwnerSleeperLink reference only Owner), so `create_all` succeeds and the tests pass standalone.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/ backend/tests/conftest.py backend/tests/test_models_identity.py
git commit -m "feat: add base model, identity tables, and test fixtures"
```

---

### Task 3: Competition tables

**Files:**
- Create: `backend/app/models/competition.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_competition.py`

**Interfaces:**
- Consumes: `app.models.base.Base`, `TimestampMixin`; `app.models.identity` (to add `LeagueAdminGrant`).
- Produces:
  - `app.models.competition.SeasonStatus` — `enum.Enum` with `SETUP`, `REGULAR`, `PLAYOFFS`, `COMPLETE`.
  - `Season(id, year, status, scoring_ruleset_id, playoff_field_per_league, nfl_playoff_weeks, created_at, updated_at)` — `nfl_playoff_weeks` is a JSON list of ints.
  - `ScoringRuleset(id, name, version, rules, created_at, updated_at)` — `rules` is JSON.
  - `League(id, season_id, sleeper_league_id, name, commish_sleeper_id, scoring_validated, created_at, updated_at)`.
  - `Team(id, league_id, sleeper_roster_id, owner_id, sleeper_user_id, wins, losses, ties, points_for, points_against, league_finish)`.
  - `app.models.identity.LeagueAdminGrant(id, account_id, league_id)` — added to `identity.py` now that `league` exists.

- [ ] **Step 1: Create `backend/app/models/competition.py`**

```python
import enum

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class SeasonStatus(enum.Enum):
    SETUP = "setup"
    REGULAR = "regular"
    PLAYOFFS = "playoffs"
    COMPLETE = "complete"


class ScoringRuleset(Base, TimestampMixin):
    __tablename__ = "scoring_ruleset"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    rules: Mapped[dict] = mapped_column(JSON, default=dict)


class Season(Base, TimestampMixin):
    __tablename__ = "season"

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, unique=True)
    status: Mapped[SeasonStatus] = mapped_column(
        Enum(SeasonStatus, name="season_status"), default=SeasonStatus.SETUP
    )
    scoring_ruleset_id: Mapped[int | None] = mapped_column(
        ForeignKey("scoring_ruleset.id", ondelete="SET NULL")
    )
    playoff_field_per_league: Mapped[int] = mapped_column(Integer, default=2)
    nfl_playoff_weeks: Mapped[list] = mapped_column(JSON, default=list)

    leagues: Mapped[list["League"]] = relationship(
        back_populates="season", cascade="all, delete-orphan"
    )


class League(Base, TimestampMixin):
    __tablename__ = "league"
    __table_args__ = (
        UniqueConstraint("season_id", "sleeper_league_id", name="uq_league_season_sleeper"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("season.id", ondelete="CASCADE"))
    sleeper_league_id: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(150))
    commish_sleeper_id: Mapped[str | None] = mapped_column(String(50))
    scoring_validated: Mapped[bool] = mapped_column(Boolean, default=False)

    season: Mapped["Season"] = relationship(back_populates="leagues")
    teams: Mapped[list["Team"]] = relationship(
        back_populates="league", cascade="all, delete-orphan"
    )


class Team(Base):
    __tablename__ = "team"
    __table_args__ = (
        UniqueConstraint("league_id", "sleeper_roster_id", name="uq_team_league_roster"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("league.id", ondelete="CASCADE"))
    sleeper_roster_id: Mapped[int] = mapped_column(Integer)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id", ondelete="SET NULL"))
    sleeper_user_id: Mapped[str | None] = mapped_column(String(50))
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    ties: Mapped[int] = mapped_column(Integer, default=0)
    points_for: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    points_against: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    league_finish: Mapped[int | None] = mapped_column(Integer)

    league: Mapped["League"] = relationship(back_populates="teams")
```

- [ ] **Step 2: Add `LeagueAdminGrant` to `backend/app/models/identity.py`**

Append this class to the end of `identity.py` (the `league` table it references now exists):

```python
class LeagueAdminGrant(Base):
    __tablename__ = "league_admin_grant"
    __table_args__ = (
        UniqueConstraint("account_id", "league_id", name="uq_league_admin_grant"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    league_id: Mapped[int] = mapped_column(ForeignKey("league.id", ondelete="CASCADE"))
```

(`ForeignKey`, `UniqueConstraint`, `Mapped`, `mapped_column`, and `Base` are already imported in `identity.py`.)

- [ ] **Step 3: Update `backend/app/models/__init__.py`** to import competition models and `LeagueAdminGrant`

```python
from app.models.base import Base, TimestampMixin
from app.models.identity import (
    Account,
    AccountRole,
    LeagueAdminGrant,
    Owner,
    OwnerSleeperLink,
)
from app.models.competition import (
    League,
    Season,
    SeasonStatus,
    ScoringRuleset,
    Team,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "Account",
    "AccountRole",
    "LeagueAdminGrant",
    "Owner",
    "OwnerSleeperLink",
    "League",
    "Season",
    "SeasonStatus",
    "ScoringRuleset",
    "Team",
]
```

- [ ] **Step 4: Write the failing test `backend/tests/test_models_competition.py`**

```python
from decimal import Decimal

from app.models import (
    Account,
    AccountRole,
    League,
    LeagueAdminGrant,
    Owner,
    Season,
    SeasonStatus,
    ScoringRuleset,
    Team,
)


def test_season_with_league_and_team_roundtrip(db_session):
    ruleset = ScoringRuleset(name="Standard PPR", version=1, rules={"rec": 1.0})
    db_session.add(ruleset)
    db_session.flush()

    season = Season(
        year=2026,
        status=SeasonStatus.SETUP,
        scoring_ruleset_id=ruleset.id,
        playoff_field_per_league=2,
        nfl_playoff_weeks=[15, 16, 17],
    )
    league = League(sleeper_league_id="987", name="Alpha League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()

    owner = Owner(first_name="Sam", last_name="Smith")
    db_session.add(owner)
    db_session.flush()

    team = Team(
        league_id=league.id,
        sleeper_roster_id=1,
        owner_id=owner.id,
        wins=10,
        losses=3,
        points_for=Decimal("1450.55"),
    )
    db_session.add(team)
    db_session.commit()

    loaded = db_session.query(Season).filter_by(year=2026).one()
    assert loaded.nfl_playoff_weeks == [15, 16, 17]
    assert loaded.status is SeasonStatus.SETUP
    assert len(loaded.leagues) == 1
    assert loaded.leagues[0].teams[0].points_for == Decimal("1450.55")
    assert loaded.leagues[0].teams[0].wins == 10


def test_league_admin_grant_links_account_to_league(db_session):
    season = Season(year=2029)
    league = League(sleeper_league_id="222", name="Delta League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()

    account = Account(email="commish@example.com", password_hash="x", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(account)
    db_session.flush()

    grant = LeagueAdminGrant(account_id=account.id, league_id=league.id)
    db_session.add(grant)
    db_session.commit()

    loaded = db_session.query(LeagueAdminGrant).filter_by(account_id=account.id).one()
    assert loaded.league_id == league.id
```

- [ ] **Step 5: Run competition + identity tests to verify they pass**

Run: `uv run pytest tests/test_models_competition.py tests/test_models_identity.py -v`
Expected: PASS (all tests). The `league` table now exists, so the `LeagueAdminGrant` FK resolves and both modules' tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/competition.py backend/app/models/identity.py backend/app/models/__init__.py backend/tests/test_models_competition.py
git commit -m "feat: add competition tables and league admin grant"
```

---

### Task 4: Scoring tables

**Files:**
- Create: `backend/app/models/scoring.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_scoring.py`

**Interfaces:**
- Consumes: `Base`, `TimestampMixin`, `Team` (FK target).
- Produces:
  - `WeeklyScore(id, team_id, week, sleeper_points, recomputed_points, bench_points, mismatch_flag, is_final)` — unique on `(team_id, week)`.
  - `Player(id, sleeper_player_id, full_name, position, nfl_team, updated_at)` — unique `sleeper_player_id`.
  - `PlayerStatCache(id, sleeper_player_id, season, week, stats)` — unique `(sleeper_player_id, season, week)`; `stats` is JSON.

- [ ] **Step 1: Create `backend/app/models/scoring.py`**

```python
from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class WeeklyScore(Base):
    __tablename__ = "weekly_score"
    __table_args__ = (
        UniqueConstraint("team_id", "week", name="uq_weekly_score_team_week"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id", ondelete="CASCADE"))
    week: Mapped[int] = mapped_column(Integer)
    sleeper_points: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    recomputed_points: Mapped[float | None] = mapped_column(Numeric(10, 2))
    bench_points: Mapped[float | None] = mapped_column(Numeric(10, 2))
    mismatch_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)


class Player(Base, TimestampMixin):
    __tablename__ = "player"

    id: Mapped[int] = mapped_column(primary_key=True)
    sleeper_player_id: Mapped[str] = mapped_column(String(50), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(150))
    position: Mapped[str | None] = mapped_column(String(10))
    nfl_team: Mapped[str | None] = mapped_column(String(10))


class PlayerStatCache(Base):
    __tablename__ = "player_stat_cache"
    __table_args__ = (
        UniqueConstraint(
            "sleeper_player_id", "season", "week", name="uq_player_stat_cache"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sleeper_player_id: Mapped[str] = mapped_column(String(50))
    season: Mapped[int] = mapped_column(Integer)
    week: Mapped[int] = mapped_column(Integer)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
```

- [ ] **Step 2: Update `backend/app/models/__init__.py`** to import scoring models

Add after the competition imports:

```python
from app.models.scoring import Player, PlayerStatCache, WeeklyScore
```

And add `"Player"`, `"PlayerStatCache"`, `"WeeklyScore"` to `__all__`.

- [ ] **Step 3: Write the failing test `backend/tests/test_models_scoring.py`**

```python
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import League, Season, Team, WeeklyScore, Player


def _make_team(db_session) -> Team:
    season = Season(year=2027)
    league = League(sleeper_league_id="555", name="Beta League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()
    team = Team(league_id=league.id, sleeper_roster_id=1)
    db_session.add(team)
    db_session.flush()
    return team


def test_weekly_score_roundtrip(db_session):
    team = _make_team(db_session)
    score = WeeklyScore(
        team_id=team.id,
        week=15,
        sleeper_points=Decimal("120.50"),
        recomputed_points=Decimal("120.50"),
        bench_points=Decimal("45.20"),
    )
    db_session.add(score)
    db_session.commit()

    loaded = db_session.query(WeeklyScore).filter_by(team_id=team.id, week=15).one()
    assert loaded.sleeper_points == Decimal("120.50")
    assert loaded.bench_points == Decimal("45.20")
    assert loaded.mismatch_flag is False
    assert loaded.is_final is False


def test_weekly_score_unique_team_week(db_session):
    team = _make_team(db_session)
    db_session.add(WeeklyScore(team_id=team.id, week=15, sleeper_points=Decimal("100")))
    db_session.commit()
    db_session.add(WeeklyScore(team_id=team.id, week=15, sleeper_points=Decimal("101")))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_player_unique_sleeper_id(db_session):
    db_session.add(Player(sleeper_player_id="4046", full_name="Patrick Mahomes", position="QB"))
    db_session.commit()
    db_session.add(Player(sleeper_player_id="4046", full_name="Dup"))
    with pytest.raises(IntegrityError):
        db_session.commit()
```

- [ ] **Step 4: Run scoring tests to verify they pass**

Run: `uv run pytest tests/test_models_scoring.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/scoring.py backend/app/models/__init__.py backend/tests/test_models_scoring.py
git commit -m "feat: add scoring tables (weekly_score, player, player_stat_cache)"
```

---

### Task 5: Bracket tables

**Files:**
- Create: `backend/app/models/bracket.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_bracket.py`

**Interfaces:**
- Consumes: `Base`, `TimestampMixin`, `Season`, `Team` (FK targets).
- Produces:
  - `app.models.bracket.BracketStatus` — `enum.Enum` with `PENDING`, `ACTIVE`, `COMPLETE`.
  - `app.models.bracket.QualifiedVia` — `enum.Enum` with `AUTO`, `WILDCARD`.
  - `Bracket(id, season_id, size, status)` — unique `season_id`.
  - `BracketSeed(id, bracket_id, team_id, seed, qualified_via)`.
  - `BracketMatchup(id, bracket_id, round, nfl_week, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, is_finalized, bye)`.

- [ ] **Step 1: Create `backend/app/models/bracket.py`**

```python
import enum

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BracketStatus(enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETE = "complete"


class QualifiedVia(enum.Enum):
    AUTO = "auto"
    WILDCARD = "wildcard"


class Bracket(Base):
    __tablename__ = "bracket"

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(
        ForeignKey("season.id", ondelete="CASCADE"), unique=True
    )
    size: Mapped[int] = mapped_column(Integer)
    status: Mapped[BracketStatus] = mapped_column(
        Enum(BracketStatus, name="bracket_status"), default=BracketStatus.PENDING
    )


class BracketSeed(Base):
    __tablename__ = "bracket_seed"
    __table_args__ = (
        UniqueConstraint("bracket_id", "seed", name="uq_bracket_seed_position"),
        UniqueConstraint("bracket_id", "team_id", name="uq_bracket_seed_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bracket_id: Mapped[int] = mapped_column(ForeignKey("bracket.id", ondelete="CASCADE"))
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id", ondelete="CASCADE"))
    seed: Mapped[int] = mapped_column(Integer)
    qualified_via: Mapped[QualifiedVia] = mapped_column(
        Enum(QualifiedVia, name="qualified_via"), default=QualifiedVia.AUTO
    )


class BracketMatchup(Base):
    __tablename__ = "bracket_matchup"

    id: Mapped[int] = mapped_column(primary_key=True)
    bracket_id: Mapped[int] = mapped_column(ForeignKey("bracket.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column(Integer)
    nfl_week: Mapped[int] = mapped_column(Integer)
    team_a_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    team_b_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    team_a_score: Mapped[float | None] = mapped_column(Numeric(10, 2))
    team_b_score: Mapped[float | None] = mapped_column(Numeric(10, 2))
    winner_team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    bye: Mapped[bool] = mapped_column(Boolean, default=False)
```

- [ ] **Step 2: Update `backend/app/models/__init__.py`** to import bracket models

Add after the scoring imports:

```python
from app.models.bracket import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    QualifiedVia,
)
```

And add `"Bracket"`, `"BracketMatchup"`, `"BracketSeed"`, `"BracketStatus"`, `"QualifiedVia"` to `__all__`.

- [ ] **Step 3: Write the failing test `backend/tests/test_models_bracket.py`**

```python
from decimal import Decimal

from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    League,
    QualifiedVia,
    Season,
    Team,
)


def _make_two_teams(db_session, season):
    league = League(sleeper_league_id="111", name="Gamma League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()
    t1 = Team(league_id=league.id, sleeper_roster_id=1)
    t2 = Team(league_id=league.id, sleeper_roster_id=2)
    db_session.add_all([t1, t2])
    db_session.flush()
    return t1, t2


def test_bracket_with_seeds_and_matchup(db_session):
    season = Season(year=2028)
    t1, t2 = _make_two_teams(db_session, season)

    bracket = Bracket(season_id=season.id, size=8, status=BracketStatus.PENDING)
    db_session.add(bracket)
    db_session.flush()

    db_session.add_all(
        [
            BracketSeed(bracket_id=bracket.id, team_id=t1.id, seed=1, qualified_via=QualifiedVia.AUTO),
            BracketSeed(bracket_id=bracket.id, team_id=t2.id, seed=8, qualified_via=QualifiedVia.AUTO),
        ]
    )
    matchup = BracketMatchup(
        bracket_id=bracket.id,
        round=1,
        nfl_week=15,
        team_a_id=t1.id,
        team_b_id=t2.id,
        team_a_score=Decimal("110.00"),
        team_b_score=Decimal("99.50"),
        winner_team_id=t1.id,
        is_finalized=True,
    )
    db_session.add(matchup)
    db_session.commit()

    loaded = db_session.query(Bracket).filter_by(season_id=season.id).one()
    assert loaded.size == 8
    seeds = db_session.query(BracketSeed).filter_by(bracket_id=loaded.id).all()
    assert {s.seed for s in seeds} == {1, 8}
    m = db_session.query(BracketMatchup).filter_by(bracket_id=loaded.id).one()
    assert m.winner_team_id == t1.id
    assert m.is_finalized is True
    assert m.bye is False
```

- [ ] **Step 4: Run bracket tests to verify they pass**

Run: `uv run pytest tests/test_models_bracket.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Run the full model suite**

Run: `uv run pytest -v`
Expected: PASS (all tests across health + all model modules).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/bracket.py backend/app/models/__init__.py backend/tests/test_models_bracket.py
git commit -m "feat: add bracket tables (bracket, seed, matchup)"
```

---

### Task 6: Alembic migrations

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Create: `backend/alembic/versions/` (directory, via `alembic init`)
- Create: `backend/alembic/versions/<hash>_initial_schema.py` (autogenerated)
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: `app.models.base.Base.metadata`, `app.config.settings.database_url`.
- Produces: a working `alembic upgrade head` / `alembic downgrade base` cycle that builds the full schema.

- [ ] **Step 1: Initialize Alembic**

Run: `uv run alembic init alembic`
Expected: creates `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, and `alembic/versions/`.

- [ ] **Step 2: Point `alembic.ini` away from a hardcoded URL**

In `backend/alembic.ini`, find the `sqlalchemy.url = ...` line and set it empty (the URL is injected in `env.py`):

```ini
sqlalchemy.url =
```

- [ ] **Step 3: Replace `backend/alembic/env.py`** with a version wired to our settings + metadata

```python
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

import app.models  # noqa: F401  (registers all tables)
from app.config import settings
from app.models.base import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Autogenerate the initial migration**

Run: `uv run alembic revision --autogenerate -m "initial schema"`
Expected: a new file appears in `alembic/versions/`. Open it and confirm `upgrade()` contains `op.create_table(...)` calls for every table: `owner`, `owner_sleeper_link`, `account`, `league_admin_grant`, `scoring_ruleset`, `season`, `league`, `team`, `weekly_score`, `player`, `player_stat_cache`, `bracket`, `bracket_seed`, `bracket_matchup`.

- [ ] **Step 5: Apply the migration to the dev database**

Run: `uv run alembic upgrade head`
Expected: "Running upgrade -> <hash>, initial schema" with no errors.

- [ ] **Step 6: Write the migration round-trip test `backend/tests/test_migrations.py`**

```python
import subprocess

from sqlalchemy import create_engine, inspect

from app.config import settings

EXPECTED_TABLES = {
    "owner",
    "owner_sleeper_link",
    "account",
    "league_admin_grant",
    "scoring_ruleset",
    "season",
    "league",
    "team",
    "weekly_score",
    "player",
    "player_stat_cache",
    "bracket",
    "bracket_seed",
    "bracket_matchup",
}


def _run(*args: str) -> None:
    result = subprocess.run(
        ["uv", "run", "alembic", *args],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_migration_upgrade_creates_all_tables():
    _run("downgrade", "base")
    _run("upgrade", "head")

    engine = create_engine(settings.database_url, future=True)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    missing = EXPECTED_TABLES - tables
    assert not missing, f"missing tables after upgrade: {missing}"


def test_migration_downgrade_drops_app_tables():
    _run("downgrade", "base")

    engine = create_engine(settings.database_url, future=True)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    leftover = EXPECTED_TABLES & tables
    assert not leftover, f"tables not dropped after downgrade: {leftover}"

    _run("upgrade", "head")  # restore for subsequent use
```

- [ ] **Step 7: Run the migration test**

Run: `uv run pytest tests/test_migrations.py -v`
Expected: PASS (2 passed). Note: this test runs against the dev database (`DATABASE_URL`), exercising real Alembic up/down migrations.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic.ini backend/alembic/ backend/tests/test_migrations.py
git commit -m "feat: add Alembic migrations with initial schema"
```

---

### Task 7: Railway config + README

**Files:**
- Create: `backend/Procfile`
- Create: `backend/railway.json`
- Create: `backend/README.md`

**Interfaces:**
- Produces: deployment configuration so Railway builds the backend, runs migrations before deploy, and starts the API.

- [ ] **Step 1: Create `backend/Procfile`**

```procfile
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 2: Create `backend/railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "preDeployCommand": "alembic upgrade head",
    "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 3: Create `backend/README.md`**

```markdown
# Insight2Redraft — Backend

FastAPI + SQLAlchemy + Postgres backend for the cross-league fantasy platform.

## Local setup

1. Start Postgres and create databases (see plan prerequisite, or use your own):

   ```bash
   docker run --name i2r-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
     -p 5432:5432 -d postgres:16
   docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft;"
   docker exec -i i2r-pg psql -U postgres -c "CREATE DATABASE insight2redraft_test;"
   ```

2. Copy env and install deps:

   ```bash
   cp .env.example .env
   uv sync
   ```

3. Apply migrations and run:

   ```bash
   uv run alembic upgrade head
   uv run uvicorn app.main:app --reload
   ```

   Health check: http://localhost:8000/health

## Tests

```bash
uv run pytest -v
```

## Deployment (Railway)

- The service builds with Nixpacks (auto-detected from `pyproject.toml` + `uv.lock`).
- `railway.json` runs `alembic upgrade head` as the pre-deploy command, then starts uvicorn.
- Set `DATABASE_URL` in the Railway service to the provided Postgres plugin URL
  (use the `postgresql+psycopg://` driver prefix).
```

- [ ] **Step 4: Final full-suite run**

Run: `uv run pytest -v`
Expected: PASS (all tests: health, identity, competition, scoring, bracket, migrations).

- [ ] **Step 5: Commit**

```bash
git add backend/Procfile backend/railway.json backend/README.md
git commit -m "chore: add Railway deploy config and backend README"
```

---

## Self-Review Notes

- **Spec coverage:** This plan covers the entire Data Model section of the spec (all 14 tables across identity, competition, scoring, bracket) plus the project scaffolding and Railway hosting decision. The Sleeper client, scoring engine, sync worker, bracket engine, API/auth, history aggregation, and frontend are explicitly deferred to Plans 2–7.
- **Deferred-but-noted:** `nfl_playoff_weeks` stored as JSON list; `points_for`/scores as `Numeric(10,2)`; enums for `AccountRole`, `SeasonStatus`, `BracketStatus`, `QualifiedVia`. These match the spec's data model.
- **Cross-task type consistency:** Model/enum names and FK targets are consistent across tasks. `LeagueAdminGrant` (FK to `league`) is deferred from Task 2 to Task 3, where the `league` table exists — so every task's `create_all` is FK-closed and each task's tests pass standalone.
- **Each task independently green:** Every task ends with a passing `pytest` run against only the tables defined so far; no task depends on a later task to go green.
