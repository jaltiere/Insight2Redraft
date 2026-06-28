import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperError, SleeperNotFound, SleeperUnavailable
from app.sleeper.models import NflState, SleeperLeague, SleeperMatchup, SleeperPlayer, SleeperRoster, SleeperUser

_STATE_JSON = {"season": "2024", "week": 5, "season_type": "regular", "leg": 5}

_FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(name: str):
    return json.loads((_FIXTURES / name).read_text())


async def _noop_sleep(_seconds: float) -> None:
    return None


class _FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now


def _client(handler, **kwargs) -> SleeperClient:
    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep, **kwargs)


def _route_client(routes: dict[str, object], **kwargs) -> SleeperClient:
    """A client whose MockTransport returns a fixture payload by URL-path suffix."""

    def handler(request):
        for suffix, payload in routes.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})

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


async def test_unexpected_4xx_raises_sleeper_error_without_retry():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, json={})

    async with _client(handler) as c:
        with pytest.raises(SleeperError):
            await c.get_nfl_state()
    assert calls["n"] == 1


async def test_retry_after_header_is_honored():
    delays = []

    async def recording_sleep(seconds):
        delays.append(seconds)

    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0.01"}, json={})
        return httpx.Response(200, json=_STATE_JSON)

    async with SleeperClient(transport=httpx.MockTransport(handler), sleep=recording_sleep) as c:
        state = await c.get_nfl_state()
    assert delays == [0.01]
    assert state.week == 5


async def test_get_league_parses_scoring_settings():
    async with _route_client({"/league/987654321": _fixture("league.json")}) as c:
        league = await c.get_league("987654321")
    assert isinstance(league, SleeperLeague)
    assert league.name == "Alpha League"
    assert league.scoring_settings["rec"] == 1.0
    assert "QB" in league.roster_positions


async def test_get_league_users_marks_commissioner():
    async with _route_client({"/league/987654321/users": _fixture("users.json")}) as c:
        users = await c.get_league_users("987654321")
    assert [u.user_id for u in users] == ["100", "200", "300"]
    by_id = {u.user_id: u for u in users}
    assert by_id["100"].is_commissioner is True
    assert by_id["200"].is_commissioner is False
    assert by_id["300"].is_commissioner is False


async def test_get_league_rosters_combines_points():
    async with _route_client({"/league/987654321/rosters": _fixture("rosters.json")}) as c:
        rosters = await c.get_league_rosters("987654321")
    assert all(isinstance(r, SleeperRoster) for r in rosters)
    first = next(r for r in rosters if r.roster_id == 1)
    assert first.settings.wins == 9
    assert first.points_for == 1521.40


async def test_get_matchups_exposes_lineups():
    async with _route_client({"/league/987654321/matchups/15": _fixture("matchups.json")}) as c:
        matchups = await c.get_matchups("987654321", 15)
    assert all(isinstance(m, SleeperMatchup) for m in matchups)
    r1 = next(m for m in matchups if m.roster_id == 1)
    assert r1.starters == ["4046"]
    assert r1.players_points["4046"] == 24.5


async def test_get_weekly_stats_returns_raw_stat_maps():
    async with _route_client({"/stats/nfl/regular/2024/15": _fixture("weekly_stats.json")}) as c:
        stats = await c.get_weekly_stats("2024", 15)
    assert stats["4046"]["pass_yd"] == 305
    assert stats["6794"]["rec"] == 6


_PLAYERS_JSON = {
    "4046": {"full_name": "Patrick Mahomes", "position": "QB", "team": "KC"},
    "6794": {"full_name": "Amon-Ra St. Brown", "position": "WR", "team": "DET"},
}


async def test_get_players_parses_and_keys_by_id():
    def handler(request):
        return httpx.Response(200, json=_PLAYERS_JSON)

    async with _client(handler) as c:
        players = await c.get_players()
    assert isinstance(players["4046"], SleeperPlayer)
    assert players["4046"].player_id == "4046"
    assert players["4046"].full_name == "Patrick Mahomes"


async def test_get_players_is_cached_single_fetch():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json=_PLAYERS_JSON)

    async with _client(handler) as c:
        await c.get_players()
        await c.get_players()
    assert calls["n"] == 1


async def test_get_players_refetches_after_ttl():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json=_PLAYERS_JSON)

    clock = _FakeClock()
    async with _client(handler, players_cache_ttl=100.0, clock=clock) as c:
        await c.get_players()
        clock.now += 101
        await c.get_players()
    assert calls["n"] == 2


async def test_get_players_concurrent_calls_fetch_once():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json=_PLAYERS_JSON)

    async with _client(handler) as c:
        await asyncio.gather(c.get_players(), c.get_players())
    assert calls["n"] == 1
