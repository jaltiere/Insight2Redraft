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
