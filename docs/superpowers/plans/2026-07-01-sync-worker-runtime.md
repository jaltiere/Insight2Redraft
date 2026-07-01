# Sync Worker Runtime (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `app/worker` — the long-running service that drives the Plan 3a `SyncService` across all leagues of the active season on an NFL-game-window-aware cadence, with per-league transaction isolation and a daily player sync.

**Architecture:** A pure `poll_interval` schedule policy over a static ET game-window table; an async `run_cycle` that fetches NFL state, resolves the active season, and syncs each league's current week in its own transaction (error-isolated); a thin `run` loop with injected clock/sleep; and a `python -m app.worker` entrypoint deployed as a separate Railway service. The worker adds no Sleeper→DB logic — that is `SyncService`.

**Tech Stack:** Python 3.14, SQLAlchemy 2.x `sessionmaker` (sync sessions, `.begin()` transactions), `zoneinfo` for ET, stdlib `logging`, httpx `MockTransport` for tests, pytest `asyncio_mode = "auto"`, Dockerized Postgres (`Insight2Redraft` container).

## Global Constraints

- The worker adds NO Sleeper→DB sync logic. It only drives `SyncService` (`sync_week`, `sync_players`); all persistence lives in `app.sync`.
- One transaction per league per cycle via `session_factory.begin()`; a per-league exception is caught, logged, and skipped — the cycle continues. A cycle-level exception is caught by the loop, logged, and the loop continues to the next tick.
- Leagues are processed sequentially (polite Sleeper consumer); no concurrency pool.
- The worker never runs alembic migrations (the web service owns them).
- Only `season_type == "regular"` counts as in-season; the cross-league super-bracket runs during NFL regular-season weeks.
- Only a `Season` with status `regular` or `playoffs` drives syncing; `setup`/`complete`/absent → idle.
- Recompute ruleset = the season's `ScoringRuleset.rules` if set, else `app.scoring.rulesets.DEFAULT_PPR`.
- The clock is a `Callable[[], datetime]` returning a timezone-aware datetime; injected everywhere for testability. No bare `datetime.now()` in logic.
- Tests make no live Sleeper calls — always `httpx.MockTransport` with fixture payloads.
- Interval magnitudes come from `app.config.settings` (`worker_interval_active`, `worker_interval_in_season`, `worker_interval_idle`, `worker_players_sync_hours`).

---

### Task 1: Config settings + schedule policy

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/worker/__init__.py`
- Create: `backend/app/worker/schedule.py`
- Create: `backend/tests/worker/__init__.py`
- Test: `backend/tests/worker/test_schedule.py`

**Interfaces:**
- Consumes: `app.sleeper.models.NflState` (`season: str`, `week: int`, `season_type: str`); `app.config.settings`.
- Produces:
  - Four new `Settings` fields: `worker_interval_active: float`, `worker_interval_in_season: float`, `worker_interval_idle: float`, `worker_players_sync_hours: float`.
  - `app.worker.schedule.GAME_WINDOWS: dict[int, list[tuple[time, time]]]` (keyed by `date.weekday()`, Mon=0..Sun=6; times in ET).
  - `app.worker.schedule.poll_interval(now: datetime, nfl_state: NflState, season_active: bool) -> float`.

- [ ] **Step 1: Add worker settings to config**

In `backend/app/config.py`, add these four fields to the `Settings` class (after `test_database_url`):

```python
    worker_interval_active: float = 180.0
    worker_interval_in_season: float = 1800.0
    worker_interval_idle: float = 21600.0
    worker_players_sync_hours: float = 24.0
```

- [ ] **Step 2: Create the worker package marker**

Create `backend/app/worker/__init__.py`:

```python
"""Sync worker: drives SyncService on an NFL-game-window-aware cadence."""
```

Create `backend/tests/worker/__init__.py` as an empty file (no content).

- [ ] **Step 3: Write the failing schedule tests**

Create `backend/tests/worker/test_schedule.py`:

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import settings
from app.sleeper.models import NflState
from app.worker.schedule import poll_interval

ET = ZoneInfo("America/New_York")


def _state(season_type: str = "regular") -> NflState:
    return NflState(season="2024", week=5, season_type=season_type)


def test_off_season_returns_idle():
    now = datetime(2024, 6, 15, 12, 0, tzinfo=ET)  # Saturday, but off-season
    assert poll_interval(now, _state("off"), True) == settings.worker_interval_idle


def test_inactive_season_returns_idle():
    now = datetime(2024, 11, 17, 13, 0, tzinfo=ET)  # Sunday 1pm, but no active season
    assert poll_interval(now, _state("regular"), False) == settings.worker_interval_idle


def test_sunday_afternoon_window_is_active():
    now = datetime(2024, 11, 17, 13, 0, tzinfo=ET)  # Sunday 1pm ET
    assert poll_interval(now, _state("regular"), True) == settings.worker_interval_active


def test_thursday_night_window_is_active():
    now = datetime(2024, 11, 14, 21, 0, tzinfo=ET)  # Thursday 9pm ET
    assert poll_interval(now, _state("regular"), True) == settings.worker_interval_active


def test_tuesday_is_in_season_off_window():
    now = datetime(2024, 11, 19, 15, 0, tzinfo=ET)  # Tuesday 3pm ET
    assert poll_interval(now, _state("regular"), True) == settings.worker_interval_in_season


def test_sunday_morning_before_window_is_off_window():
    now = datetime(2024, 11, 17, 9, 0, tzinfo=ET)  # Sunday 9am ET, before the 1pm slate
    assert poll_interval(now, _state("regular"), True) == settings.worker_interval_in_season


def test_utc_input_is_converted_to_eastern():
    # 2024-11-18 01:00 UTC == 2024-11-17 20:00 ET (Sunday night, in window)
    now = datetime(2024, 11, 18, 1, 0, tzinfo=ZoneInfo("UTC"))
    assert poll_interval(now, _state("regular"), True) == settings.worker_interval_active
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/worker/test_schedule.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.worker.schedule'`.

- [ ] **Step 5: Implement `schedule.py`**

Create `backend/app/worker/schedule.py`:

```python
from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.config import settings
from app.sleeper.models import NflState

ET = ZoneInfo("America/New_York")

# Recurring NFL game windows in ET, keyed by weekday (Mon=0 .. Sun=6).
# Being a few minutes off is harmless — the worker only keeps scores fresh;
# round finalization is a manual admin action. Amend freely for holiday slots.
GAME_WINDOWS: dict[int, list[tuple[time, time]]] = {
    0: [(time(20, 0), time(23, 59, 59))],   # Monday night
    3: [(time(20, 0), time(23, 59, 59))],   # Thursday night
    5: [(time(13, 0), time(23, 59, 59))],   # Saturday (late season)
    6: [(time(13, 0), time(23, 59, 59))],   # Sunday main slate through SNF
}


def poll_interval(now: datetime, nfl_state: NflState, season_active: bool) -> float:
    """Seconds until the next poll, from the current time and NFL/season state."""
    if not season_active or nfl_state.season_type != "regular":
        return settings.worker_interval_idle
    local = now.astimezone(ET)
    current = local.time()
    for start, end in GAME_WINDOWS.get(local.weekday(), []):
        if start <= current <= end:
            return settings.worker_interval_active
    return settings.worker_interval_in_season
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/worker/test_schedule.py -v`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/worker/__init__.py backend/app/worker/schedule.py \
        backend/tests/worker/__init__.py backend/tests/worker/test_schedule.py
git commit -m "feat: add worker config settings + poll_interval schedule policy"
```

---

### Task 2: Cycle orchestration (`run_cycle`)

**Files:**
- Create: `backend/app/worker/cycle.py`
- Create: `backend/tests/worker/conftest.py`
- Test: `backend/tests/worker/test_cycle.py`

**Interfaces:**
- Consumes:
  - `SyncService(client, session, season, ruleset)` with `async sync_week(league_id: int, week: int)` and `async sync_players()` from `app.sync.service`.
  - `SleeperClient.get_nfl_state() -> NflState` from `app.sleeper.client`.
  - Models `Season`, `SeasonStatus`, `League`, `ScoringRuleset`, `Team`, `WeeklyScore` from `app.models`.
  - `app.scoring.rulesets.DEFAULT_PPR`; `app.config.settings.worker_players_sync_hours`.
- Produces:
  - `PlayersSyncState` — `@dataclass` with `last_synced_at: datetime | None = None`.
  - `CycleResult` — `@dataclass(frozen=True)` with `nfl_state: NflState`, `season_active: bool`, `week: int | None`, `leagues_synced: int`, `leagues_failed: int`, `players_synced: bool`.
  - `async run_cycle(client: SleeperClient, session_factory: sessionmaker, clock: Callable[[], datetime], players_state: PlayersSyncState) -> CycleResult`.

- [ ] **Step 1: Create the worker test conftest (savepoint-isolated session factory + mock client)**

Create `backend/tests/worker/conftest.py`:

```python
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

from app.sleeper.client import SleeperClient

# Reuse the recorded Sleeper fixtures from the sync + sleeper test packages.
_SYNC_FIXTURES = Path(__file__).parents[1] / "sync" / "fixtures"
_SLEEPER_FIXTURES = Path(__file__).parents[1] / "sleeper" / "fixtures"


def load_fixture(name: str):
    for base in (_SYNC_FIXTURES, _SLEEPER_FIXTURES):
        path = base / name
        if path.exists():
            return json.loads(path.read_text())
    raise FileNotFoundError(name)


async def _noop_sleep(_seconds: float) -> None:
    return None


def route_client(routes: dict[str, object]) -> SleeperClient:
    """SleeperClient whose MockTransport returns a payload by URL-path suffix."""

    def handler(request: httpx.Request) -> httpx.Response:
        for suffix, payload in routes.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


def fixed_clock(moment: datetime):
    return lambda: moment


UTC_NOW = datetime(2024, 11, 19, 15, 0, tzinfo=timezone.utc)  # Tuesday, off-window


@pytest.fixture()
def session_factory(engine):
    """A sessionmaker whose .begin() commits become savepoints inside one outer
    transaction that is rolled back at teardown — isolates cycle tests that
    manage their own transactions."""
    connection = engine.connect()
    transaction = connection.begin()
    factory = sessionmaker(bind=connection, join_transaction_mode="create_savepoint")
    yield factory
    if transaction.is_active:
        transaction.rollback()
    connection.close()
```

Note: `engine` is the session-scoped fixture from `backend/tests/conftest.py` (creates all tables once).

- [ ] **Step 2: Write the failing cycle tests**

Create `backend/tests/worker/test_cycle.py`:

```python
from datetime import timedelta

import pytest

from app.models import League, Season, SeasonStatus, WeeklyScore
from app.worker.cycle import CycleResult, PlayersSyncState, run_cycle
from tests.worker.conftest import UTC_NOW, fixed_clock, load_fixture, route_client

_STATE = {"season": "2024", "week": 5, "season_type": "regular", "leg": 5}


def _base_routes():
    return {
        "/state/nfl": _STATE,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321": load_fixture("league.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
        "/players/nfl": load_fixture("players.json"),
    }


def _seed_season(session_factory, *, status=SeasonStatus.REGULAR, leagues=("987654321",)):
    with session_factory.begin() as session:
        season = Season(year=2024, status=status)
        session.add(season)
        session.flush()
        for lid in leagues:
            session.add(League(season_id=season.id, sleeper_league_id=lid, name="seed"))


async def test_run_cycle_syncs_active_season_leagues(session_factory):
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState()

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert isinstance(result, CycleResult)
    assert result.season_active is True
    assert result.week == 5
    assert result.leagues_synced == 1
    assert result.leagues_failed == 0
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 2  # one per team in the league


async def test_run_cycle_idle_when_no_active_season(session_factory):
    _seed_season(session_factory, status=SeasonStatus.SETUP)
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.season_active is False
    assert result.leagues_synced == 0
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 0


async def test_run_cycle_isolates_failing_league(session_factory):
    # league 987654321 has full routes; league 555 has none -> its matchups 404 -> fails
    _seed_season(session_factory, leagues=("987654321", "555"))
    client = route_client(_base_routes())

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), PlayersSyncState())

    assert result.leagues_synced == 1
    assert result.leagues_failed == 1
    with session_factory() as session:
        assert session.query(WeeklyScore).count() == 2  # only the good league wrote rows


async def test_run_cycle_syncs_players_when_due(session_factory):
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState()  # never synced -> due

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert result.players_synced is True
    assert state.last_synced_at == UTC_NOW
    from app.models import Player

    with session_factory() as session:
        assert session.query(Player).count() == 2


async def test_run_cycle_skips_players_when_recent(session_factory):
    _seed_season(session_factory)
    client = route_client(_base_routes())
    state = PlayersSyncState(last_synced_at=UTC_NOW - timedelta(hours=1))

    result = await run_cycle(client, session_factory, fixed_clock(UTC_NOW), state)

    assert result.players_synced is False
    from app.models import Player

    with session_factory() as session:
        assert session.query(Player).count() == 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/worker/test_cycle.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.worker.cycle'`.

- [ ] **Step 4: Implement `cycle.py`**

Create `backend/app/worker/cycle.py`:

```python
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import League, ScoringRuleset, Season, SeasonStatus, Team, WeeklyScore
from app.scoring.rulesets import DEFAULT_PPR
from app.sleeper.client import SleeperClient
from app.sleeper.models import NflState
from app.sync.service import SyncService

logger = logging.getLogger(__name__)

_IDLE_STATUSES = {SeasonStatus.SETUP, SeasonStatus.COMPLETE}


@dataclass
class PlayersSyncState:
    last_synced_at: datetime | None = None


@dataclass(frozen=True)
class CycleResult:
    nfl_state: NflState
    season_active: bool
    week: int | None
    leagues_synced: int
    leagues_failed: int
    players_synced: bool


async def run_cycle(
    client: SleeperClient,
    session_factory: sessionmaker,
    clock: Callable[[], datetime],
    players_state: PlayersSyncState,
) -> CycleResult:
    nfl_state = await client.get_nfl_state()
    year = int(nfl_state.season)
    week = nfl_state.week

    with session_factory() as session:
        season = session.query(Season).filter_by(year=year).one_or_none()
        if season is None or season.status in _IDLE_STATUSES:
            logger.info("cycle idle: no active season for %s", year)
            return CycleResult(nfl_state, False, None, 0, 0, False)
        season_id = season.id
        league_ids = [
            row.id for row in session.query(League).filter_by(season_id=season.id).all()
        ]
        ruleset_row = (
            session.get(ScoringRuleset, season.scoring_ruleset_id)
            if season.scoring_ruleset_id
            else None
        )
        ruleset = ruleset_row.rules if ruleset_row else DEFAULT_PPR

    synced = 0
    failed = 0
    for league_id in league_ids:
        try:
            with session_factory.begin() as session:
                season = session.get(Season, season_id)
                service = SyncService(client, session, season, ruleset)
                await service.sync_week(league_id, week)
                mismatches = (
                    session.query(WeeklyScore)
                    .join(Team, WeeklyScore.team_id == Team.id)
                    .filter(
                        Team.league_id == league_id,
                        WeeklyScore.week == week,
                        WeeklyScore.mismatch_flag.is_(True),
                    )
                    .count()
                )
                logger.info(
                    "league %s week %s synced: mismatches=%s", league_id, week, mismatches
                )
            synced += 1
        except Exception:
            logger.exception("league %s week %s sync failed", league_id, week)
            failed += 1

    players_synced = await _maybe_sync_players(
        client, session_factory, clock, players_state, season_id, ruleset
    )
    return CycleResult(nfl_state, True, week, synced, failed, players_synced)


def _players_due(players_state: PlayersSyncState, now: datetime) -> bool:
    if players_state.last_synced_at is None:
        return True
    return now - players_state.last_synced_at >= timedelta(
        hours=settings.worker_players_sync_hours
    )


async def _maybe_sync_players(
    client, session_factory, clock, players_state, season_id, ruleset
) -> bool:
    now = clock()
    if not _players_due(players_state, now):
        return False
    try:
        with session_factory.begin() as session:
            season = session.get(Season, season_id)
            service = SyncService(client, session, season, ruleset)
            await service.sync_players()
        players_state.last_synced_at = now
        return True
    except Exception:
        logger.exception("players sync failed")
        return False
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/worker/test_cycle.py -v`
Expected: PASS (5 tests). Requires the `Insight2Redraft` Postgres container running (`docker start Insight2Redraft`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/worker/cycle.py backend/tests/worker/conftest.py backend/tests/worker/test_cycle.py
git commit -m "feat: add worker run_cycle with per-league isolation + daily player sync"
```

---

### Task 3: Runner loop (`run`)

**Files:**
- Create: `backend/app/worker/runner.py`
- Test: `backend/tests/worker/test_runner.py`

**Interfaces:**
- Consumes: `app.worker.cycle.run_cycle`, `CycleResult`, `PlayersSyncState`; `app.worker.schedule.poll_interval`; `app.config.settings`.
- Produces:
  - `async run(client, session_factory, clock, sleep, should_continue, *, players_state, run_cycle=cycle.run_cycle) -> None`, where `sleep: Callable[[float], Awaitable[None]]` and `should_continue: Callable[[], bool]`.

- [ ] **Step 1: Write the failing runner tests**

Create `backend/tests/worker/test_runner.py`:

```python
from datetime import datetime, timezone

from app.config import settings
from app.sleeper.models import NflState
from app.worker.cycle import CycleResult, PlayersSyncState
from app.worker.runner import run

NOW = datetime(2024, 11, 17, 13, 0, tzinfo=timezone.utc)  # Sunday 1pm UTC == 8am ET (off-window)


def _stopper(n: int):
    calls = {"n": 0}

    def should_continue() -> bool:
        calls["n"] += 1
        return calls["n"] <= n

    return should_continue


def _sleep_recorder():
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)

    return slept, sleep


async def test_run_invokes_cycle_each_iteration_and_sleeps_interval():
    cycle_calls = {"n": 0}
    result = CycleResult(
        nfl_state=NflState(season="2024", week=5, season_type="regular"),
        season_active=True, week=5, leagues_synced=1, leagues_failed=0, players_synced=False,
    )

    async def fake_cycle(client, session_factory, clock, players_state):
        cycle_calls["n"] += 1
        return result

    slept, sleep = _sleep_recorder()
    await run(
        None, None, lambda: NOW, sleep, _stopper(3),
        players_state=PlayersSyncState(), run_cycle=fake_cycle,
    )

    assert cycle_calls["n"] == 3
    # Sunday 8am ET is in-season but outside a window -> in_season interval.
    assert slept == [settings.worker_interval_in_season] * 3


async def test_run_uses_idle_interval_when_cycle_reports_inactive():
    result = CycleResult(
        nfl_state=NflState(season="2024", week=5, season_type="off"),
        season_active=False, week=None, leagues_synced=0, leagues_failed=0, players_synced=False,
    )

    async def fake_cycle(client, session_factory, clock, players_state):
        return result

    slept, sleep = _sleep_recorder()
    await run(
        None, None, lambda: NOW, sleep, _stopper(1),
        players_state=PlayersSyncState(), run_cycle=fake_cycle,
    )

    assert slept == [settings.worker_interval_idle]


async def test_run_survives_cycle_exception():
    async def boom(client, session_factory, clock, players_state):
        raise RuntimeError("sleeper down")

    slept, sleep = _sleep_recorder()
    await run(
        None, None, lambda: NOW, sleep, _stopper(2),
        players_state=PlayersSyncState(), run_cycle=boom,
    )

    # Loop keeps going despite the exception; falls back to the idle interval.
    assert slept == [settings.worker_interval_idle] * 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/worker/test_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.worker.runner'`.

- [ ] **Step 3: Implement `runner.py`**

Create `backend/app/worker/runner.py`:

```python
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime

from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.sleeper.client import SleeperClient
from app.worker import cycle
from app.worker.cycle import PlayersSyncState
from app.worker.schedule import poll_interval

logger = logging.getLogger(__name__)


async def run(
    client: SleeperClient,
    session_factory: sessionmaker,
    clock: Callable[[], datetime],
    sleep: Callable[[float], Awaitable[None]],
    should_continue: Callable[[], bool],
    *,
    players_state: PlayersSyncState,
    run_cycle: Callable[..., Awaitable[cycle.CycleResult]] = cycle.run_cycle,
) -> None:
    """Run sync cycles until ``should_continue()`` is False, sleeping the
    schedule-computed interval between them."""
    while should_continue():
        try:
            result = await run_cycle(client, session_factory, clock, players_state)
            interval = poll_interval(clock(), result.nfl_state, result.season_active)
        except Exception:
            logger.exception("cycle failed")
            interval = settings.worker_interval_idle
        await sleep(interval)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/worker/test_runner.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker/runner.py backend/tests/worker/test_runner.py
git commit -m "feat: add worker runner loop with schedule-driven cadence"
```

---

### Task 4: Entrypoint + deployment

**Files:**
- Create: `backend/app/worker/__main__.py`
- Modify: `backend/Procfile`
- Test: `backend/tests/worker/test_main.py`

**Interfaces:**
- Consumes: `app.config.settings.database_url`; `SleeperClient`; `app.worker.runner.run`; `app.worker.cycle.PlayersSyncState`.
- Produces:
  - `app.worker.__main__.create_session_factory() -> sessionmaker`.
  - `app.worker.__main__.utc_clock() -> datetime` (timezone-aware, UTC).
  - `async app.worker.__main__.main() -> None` (builds real deps, runs forever).

- [ ] **Step 1: Write the failing entrypoint tests**

Create `backend/tests/worker/test_main.py`:

```python
from datetime import timezone

from sqlalchemy.orm import sessionmaker

from app.worker.__main__ import create_session_factory, utc_clock


def test_create_session_factory_returns_sessionmaker():
    factory = create_session_factory()
    assert isinstance(factory, sessionmaker)


def test_utc_clock_is_timezone_aware_utc():
    now = utc_clock()
    assert now.tzinfo is not None
    assert now.utcoffset() == timezone.utc.utcoffset(None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/worker/test_main.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.worker.__main__'`.

- [ ] **Step 3: Implement `__main__.py`**

Create `backend/app/worker/__main__.py`:

```python
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.sleeper.client import SleeperClient
from app.worker.cycle import PlayersSyncState
from app.worker.runner import run


def create_session_factory() -> sessionmaker:
    engine = create_engine(settings.database_url, future=True)
    return sessionmaker(bind=engine)


def utc_clock() -> datetime:
    return datetime.now(timezone.utc)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    session_factory = create_session_factory()
    client = SleeperClient()
    try:
        await run(
            client,
            session_factory,
            utc_clock,
            asyncio.sleep,
            lambda: True,
            players_state=PlayersSyncState(),
        )
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/worker/test_main.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the worker process to the Procfile**

`backend/Procfile` currently contains one line (`web: ...`). Add a second line so the file reads:

```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
worker: python -m app.worker
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/worker/__main__.py backend/Procfile backend/tests/worker/test_main.py
git commit -m "feat: add worker entrypoint + Procfile worker process"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Ensure Postgres is running**

Run: `docker start Insight2Redraft`
Expected: prints `Insight2Redraft`.

- [ ] **Step 2: Run the full backend suite**

Run: `cd backend && uv run pytest -q`
Expected: PASS — all prior tests plus the new worker tests (7 schedule + 5 cycle + 3 runner + 2 main = 17), clean except the single pre-existing Starlette/httpx deprecation warning from the health test.

- [ ] **Step 3: Confirm branch state**

Run: `git status` and `git log --oneline a928b85..HEAD` (a928b85 is the merge-base with main from before Plan 3a; use `git merge-base main HEAD` if unsure).
Expected: clean working tree; the 3b spec, plan, and four feature commits present.

---

## Self-Review

- **Spec coverage:**
  - Module structure (`schedule.py` pure, `cycle.py` one pass, `runner.py` thin loop, `__main__.py` entrypoint) → Tasks 1–4.
  - Scheduler policy (regular-only + `season_active` → idle; ET window table; active/in-season/idle intervals) → Task 1.
  - Cycle orchestration (get_nfl_state, active-season resolution, per-league transaction + isolation, sequential, ruleset fallback, daily player gate, mismatch logging) → Task 2.
  - Transaction/error model (per-league `session_factory.begin()`, log-and-continue, cycle-level survival in the loop) → Tasks 2–3.
  - Single `get_nfl_state` per tick (runner reuses `result.nfl_state`) → Task 3.
  - Config settings → Task 1. Entrypoint + Procfile worker + web-owns-migrations (worker runs no alembic) → Task 4.
  - Observability (per-cycle season/week, per-league scored/skipped via counts, mismatch counts, caught errors) → Task 2 logging + Task 4 `logging.basicConfig`.
  - Testing (pure schedule tests; run_cycle with mock client + real Postgres via savepoint-isolated factory; runner with injected clock/sleep; no live calls) → Tasks 1–3; full-suite gate → Task 5.
- **Placeholder scan:** none — every code step contains the complete, correct code (`_maybe_sync_players` is async and awaited from the start; no TODOs or stubs).
- **Type consistency:** `run_cycle` signature identical across cycle.py, its tests, and the runner's `run_cycle` parameter default; `CycleResult`/`PlayersSyncState` fields consistent between definition (Task 2) and use (Tasks 2–3); `poll_interval(now, nfl_state, season_active)` consistent between Task 1 and Task 3; `session_factory.begin()` used uniformly; `SyncService(client, session, season, ruleset)` matches `app/sync/service.py`.
- **Deferred (correctly absent):** DEF/K mismatch fix (worker only logs mismatch counts), live per-game schedule feed, `sync_league_setup`/"sync now" (API plan).
