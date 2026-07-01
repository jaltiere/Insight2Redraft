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
