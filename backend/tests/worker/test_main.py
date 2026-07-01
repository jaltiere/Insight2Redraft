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
