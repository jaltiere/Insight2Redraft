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
