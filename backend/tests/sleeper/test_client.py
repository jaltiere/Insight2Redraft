import httpx
import pytest

from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperNotFound, SleeperUnavailable
from app.sleeper.models import NflState

_STATE_JSON = {"season": "2024", "week": 5, "season_type": "regular", "leg": 5}


async def _noop_sleep(_seconds: float) -> None:
    return None


def _client(handler, **kwargs) -> SleeperClient:
    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep, **kwargs)


async def test_get_nfl_state_parses():
    def handler(request):
        return httpx.Response(200, json=_STATE_JSON)

    async with _client(handler) as c:
        state = await c.get_nfl_state()
    assert isinstance(state, NflState)
    assert state.week == 5


async def test_retries_on_429_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={})
        return httpx.Response(200, json=_STATE_JSON)

    async with _client(handler, max_retries=3) as c:
        state = await c.get_nfl_state()
    assert calls["n"] == 2
    assert state.week == 5


async def test_5xx_exhausts_retries_and_raises_unavailable():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(500, json={})

    async with _client(handler, max_retries=2) as c:
        with pytest.raises(SleeperUnavailable):
            await c.get_nfl_state()
    assert calls["n"] == 3  # initial attempt + 2 retries


async def test_404_raises_not_found_without_retry():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(404, json={})

    async with _client(handler) as c:
        with pytest.raises(SleeperNotFound):
            await c.get_nfl_state()
    assert calls["n"] == 1
