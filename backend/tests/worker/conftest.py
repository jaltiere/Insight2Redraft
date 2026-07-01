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
