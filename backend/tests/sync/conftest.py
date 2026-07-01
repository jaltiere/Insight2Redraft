import json
from pathlib import Path

import httpx
import pytest

from app.sleeper.client import SleeperClient

# Reuse the recorded Sleeper fixtures from the sleeper test package (DRY).
_SLEEPER_FIXTURES = Path(__file__).parents[1] / "sleeper" / "fixtures"
_SYNC_FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str):
    # Sync-local fixtures win over the shared sleeper ones. Most names resolve to
    # tests/sleeper/fixtures (DRY), but tests/sync/fixtures/weekly_stats.json
    # deliberately shadows the sleeper copy: sync tests inject a 4-key
    # MATCHING_RULESET (not DEFAULT_PPR), so the stat lines are tuned to yield the
    # recompute values those tests assert. Keep the two files separate.
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


@pytest.fixture()
def league_routes():
    """Routes covering league config, users, and rosters for league 987654321."""
    return {
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321": load_fixture("league.json"),
    }
