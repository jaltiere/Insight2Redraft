import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.sleeper.errors import SleeperError, SleeperNotFound, SleeperUnavailable
from app.sleeper.models import (
    NflState,
    SleeperLeague,
    SleeperMatchup,
    SleeperPlayer,
    SleeperRoster,
    SleeperUser,
)

DEFAULT_BASE_URL = "https://api.sleeper.app/v1"


async def _default_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


class SleeperClient:
    """Async client for Sleeper's public read API.

    Pure I/O: returns parsed Pydantic models, never touches the database. Only
    ``get_players`` is cached. Retries on 429/5xx/connection errors with
    exponential backoff; never retries 404.
    """

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 15.0,
        max_retries: int = 3,
        base_backoff: float = 0.5,
        players_cache_ttl: float = 86400.0,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = _default_sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout, transport=transport)
        self._max_retries = max_retries
        self._base_backoff = base_backoff
        self._players_cache_ttl = players_cache_ttl
        self._sleep = sleep
        self._clock = clock
        self._players_cache: tuple[float, dict] | None = None
        self._players_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "SleeperClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def _backoff(self, attempt: int, retry_after: str | None) -> None:
        delay = self._base_backoff * (2**attempt)
        if retry_after is not None:
            try:
                delay = float(retry_after)
            except ValueError:
                pass
        await self._sleep(delay)

    async def _get_json(self, path: str) -> Any:
        attempt = 0
        while True:
            try:
                response = await self._client.get(path)
            except httpx.TransportError as exc:
                if attempt >= self._max_retries:
                    raise SleeperUnavailable(f"GET {path} failed: {exc}") from exc
                await self._backoff(attempt, None)
                attempt += 1
                continue

            if response.status_code == 404:
                raise SleeperNotFound(f"GET {path} returned 404")
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= self._max_retries:
                    raise SleeperUnavailable(
                        f"GET {path} returned {response.status_code} after {attempt} retries"
                    )
                await self._backoff(attempt, response.headers.get("Retry-After"))
                attempt += 1
                continue

            if 200 <= response.status_code < 300:
                return response.json()
            raise SleeperError(
                f"GET {path} returned unexpected status {response.status_code}"
            )

    async def get_nfl_state(self) -> NflState:
        data = await self._get_json("/state/nfl")
        return NflState.model_validate(data)

    async def get_league(self, league_id: str) -> SleeperLeague:
        data = await self._get_json(f"/league/{league_id}")
        return SleeperLeague.model_validate(data)

    async def get_league_users(self, league_id: str) -> list[SleeperUser]:
        data = await self._get_json(f"/league/{league_id}/users")
        return [SleeperUser.model_validate(user) for user in data]

    async def get_league_rosters(self, league_id: str) -> list[SleeperRoster]:
        data = await self._get_json(f"/league/{league_id}/rosters")
        return [SleeperRoster.model_validate(roster) for roster in data]

    async def get_matchups(self, league_id: str, week: int) -> list[SleeperMatchup]:
        data = await self._get_json(f"/league/{league_id}/matchups/{week}")
        return [SleeperMatchup.model_validate(matchup) for matchup in data]

    async def get_weekly_stats(
        self, season: str, week: int, season_type: str = "regular"
    ) -> dict[str, dict[str, float]]:
        data = await self._get_json(f"/stats/nfl/{season_type}/{season}/{week}")
        return {pid: stats for pid, stats in data.items() if isinstance(stats, dict)}

    async def get_players(self) -> dict[str, SleeperPlayer]:
        async with self._players_lock:
            now = self._clock()
            if self._players_cache is not None:
                cached_at, cached = self._players_cache
                if now - cached_at < self._players_cache_ttl:
                    return cached
            data = await self._get_json("/players/nfl")
            players = {
                pid: SleeperPlayer.model_validate({**pdata, "player_id": pid})
                for pid, pdata in data.items()
            }
            self._players_cache = (now, players)
            return players
