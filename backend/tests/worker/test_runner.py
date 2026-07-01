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
