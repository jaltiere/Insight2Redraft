# Sleeper Client & Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two pure, database-free units the platform depends on — a tested async Sleeper API client and a data-driven scoring engine.

**Architecture:** Two standalone packages under `backend/app/`: `app.scoring` (pure `Decimal` functions over a Sleeper-format ruleset) and `app.sleeper` (an async `httpx` client returning Pydantic models, with retry/backoff and an in-memory player-dump cache). Neither imports `app.db` or `app.models`. Both are unit-tested with no database and no live network.

**Tech Stack:** Python 3.12+, httpx (async), Pydantic v2, Decimal, pytest, pytest-asyncio. `uv`-managed.

## Global Constraints

- Python `>=3.12`; all commands run via `uv run ...` from inside `backend/`.
- New code lives under `backend/app/sleeper/` and `backend/app/scoring/`; tests under `backend/tests/sleeper/` and `backend/tests/scoring/`.
- **DB-free:** no imports from `app.db` or `app.models` in either package.
- Scoring math uses `Decimal`; quantize to `Decimal("0.01")` with `ROUND_HALF_UP`.
- Ruleset format is Sleeper's `scoring_settings`: a flat `dict[str, float]` (stat key → per-unit multiplier).
- Response parsing uses Pydantic v2 models with `model_config = ConfigDict(extra="ignore")`.
- The Sleeper client is async (`httpx.AsyncClient`). Tests use `httpx.MockTransport` — **no live network calls, ever**.
- Retry only on `429` and `5xx` and connection errors; never retry `404`. Inject the sleep function in tests so they never wait on real time.
- TDD: failing test → run it fail → minimal implementation → run it pass → commit. One logical change per commit.

---

## File Structure

```
backend/app/
  scoring/
    __init__.py        # empty
    engine.py          # score_stat_line, score_players, sum_points
    rulesets.py        # DEFAULT_PPR
  sleeper/
    __init__.py        # empty
    errors.py          # SleeperError, SleeperNotFound, SleeperUnavailable
    models.py          # Pydantic response models
    client.py          # SleeperClient
backend/tests/
  scoring/
    __init__.py        # empty
    test_engine.py
    test_rulesets.py
  sleeper/
    __init__.py        # empty
    test_models.py
    test_client.py
    fixtures/
      league.json
      users.json
      rosters.json
      matchups.json
      weekly_stats.json
```

---

### Task 1: Scoring engine — `score_stat_line` + default ruleset

**Files:**
- Create: `backend/app/scoring/__init__.py` (empty)
- Create: `backend/app/scoring/engine.py`
- Create: `backend/app/scoring/rulesets.py`
- Create: `backend/tests/scoring/__init__.py` (empty)
- Test: `backend/tests/scoring/test_engine.py`
- Test: `backend/tests/scoring/test_rulesets.py`

**Interfaces:**
- Produces:
  - `app.scoring.engine.score_stat_line(stats: Mapping[str, float], ruleset: Mapping[str, float]) -> Decimal` — sums `stat_value * multiplier` over keys present in BOTH maps, quantized to 2 decimals (ROUND_HALF_UP).
  - `app.scoring.rulesets.DEFAULT_PPR: dict[str, float]` — full-PPR ruleset in Sleeper `scoring_settings` format.

- [ ] **Step 1: Create `backend/app/scoring/__init__.py` and `backend/tests/scoring/__init__.py`** (both empty files)

- [ ] **Step 2: Write the failing test `backend/tests/scoring/test_engine.py`**

```python
from decimal import Decimal

from app.scoring.engine import score_stat_line
from app.scoring.rulesets import DEFAULT_PPR


def test_score_ppr_wr_line():
    # 6 rec*1 + 88 rec_yd*0.1 + 1 rec_td*6 = 6 + 8.8 + 6 = 20.80
    stats = {"rec": 6, "rec_yd": 88, "rec_td": 1}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("20.80")


def test_score_qb_line_with_negatives():
    # 305*0.04 + 2*4 + 1*-2 + 18*0.1 = 12.2 + 8 - 2 + 1.8 = 20.00
    stats = {"pass_yd": 305, "pass_td": 2, "pass_int": 1, "rush_yd": 18}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("20.00")


def test_empty_stats_is_zero():
    assert score_stat_line({}, DEFAULT_PPR) == Decimal("0.00")


def test_disjoint_keys_contribute_nothing():
    # 'snaps' not in ruleset; 'rush_td' in ruleset but not in stats. Only rec counts.
    stats = {"snaps": 50, "rec": 4}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("4.00")


def test_rounding_is_half_up():
    # 4.25 * 0.5 = 2.125 -> quantize to 0.01 half-up -> 2.13
    assert score_stat_line({"x": 4.25}, {"x": 0.5}) == Decimal("2.13")
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `uv run pytest tests/scoring/test_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.scoring.engine'` (and `rulesets`).

- [ ] **Step 4: Create `backend/app/scoring/engine.py`**

```python
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal

_CENTS = Decimal("0.01")


def score_stat_line(stats: Mapping[str, float], ruleset: Mapping[str, float]) -> Decimal:
    """Score one player's stat line.

    Sums ``stat_value * multiplier`` over the keys present in BOTH ``stats`` and
    ``ruleset`` (keys in only one map contribute nothing), then rounds the total
    to 2 decimals using ROUND_HALF_UP. This mirrors how Sleeper scores: a
    per-unit multiplier times the stat value, summed.
    """
    total = Decimal("0")
    for key in stats.keys() & ruleset.keys():
        total += Decimal(str(stats[key])) * Decimal(str(ruleset[key]))
    return total.quantize(_CENTS, rounding=ROUND_HALF_UP)
```

- [ ] **Step 5: Create `backend/app/scoring/rulesets.py`**

```python
"""Canonical scoring rulesets in Sleeper ``scoring_settings`` format.

A ruleset is a flat ``dict[str, float]`` mapping a Sleeper stat key to its
per-unit point multiplier. The scoring engine is fully data-driven over this
format, so values here can be tweaked freely (or a season can use a different
ruleset entirely).
"""

DEFAULT_PPR: dict[str, float] = {
    # passing
    "pass_yd": 0.04,
    "pass_td": 4.0,
    "pass_int": -2.0,
    "pass_2pt": 2.0,
    # rushing
    "rush_yd": 0.1,
    "rush_td": 6.0,
    "rush_2pt": 2.0,
    # receiving (full PPR)
    "rec": 1.0,
    "rec_yd": 0.1,
    "rec_td": 6.0,
    "rec_2pt": 2.0,
    # misc offense
    "fum_lost": -2.0,
    "fum_rec_td": 6.0,
    # kicking
    "fgm_0_19": 3.0,
    "fgm_20_29": 3.0,
    "fgm_30_39": 3.0,
    "fgm_40_49": 4.0,
    "fgm_50p": 5.0,
    "fgmiss": -1.0,
    "xpm": 1.0,
    "xpmiss": -1.0,
    # team defense / special teams
    "def_td": 6.0,
    "def_st_td": 6.0,
    "st_td": 6.0,
    "sack": 1.0,
    "int": 2.0,
    "fum_rec": 2.0,
    "safe": 2.0,
    "blk_kick": 2.0,
    "ff": 1.0,
    "def_st_ff": 1.0,
    "def_st_fum_rec": 1.0,
    "pts_allow_0": 10.0,
    "pts_allow_1_6": 7.0,
    "pts_allow_7_13": 4.0,
    "pts_allow_14_20": 1.0,
    "pts_allow_21_27": 0.0,
    "pts_allow_28_34": -1.0,
    "pts_allow_35p": -4.0,
}
```

- [ ] **Step 6: Run the engine test to verify it passes**

Run: `uv run pytest tests/scoring/test_engine.py -v`
Expected: PASS (5 passed).

- [ ] **Step 7: Write the failing test `backend/tests/scoring/test_rulesets.py`**

```python
from decimal import Decimal

from app.scoring.engine import score_stat_line
from app.scoring.rulesets import DEFAULT_PPR


def test_default_ppr_is_flat_float_map():
    assert isinstance(DEFAULT_PPR, dict)
    assert all(isinstance(k, str) for k in DEFAULT_PPR)
    assert all(isinstance(v, float) for v in DEFAULT_PPR.values())


def test_default_ppr_has_core_offensive_keys():
    for key in ("pass_yd", "pass_td", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost"):
        assert key in DEFAULT_PPR


def test_default_ppr_is_full_ppr():
    assert DEFAULT_PPR["rec"] == 1.0


def test_default_ppr_scores_a_line():
    # 5 rec*1 + 50 rec_yd*0.1 + 1 rec_td*6 = 5 + 5 + 6 = 16.00
    stats = {"rec": 5, "rec_yd": 50, "rec_td": 1}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("16.00")
```

- [ ] **Step 8: Run the rulesets test to verify it passes**

Run: `uv run pytest tests/scoring/test_rulesets.py -v`
Expected: PASS (4 passed). (Implementation already exists from Steps 4–5; this test pins the ruleset's shape and values.)

- [ ] **Step 9: Commit**

```bash
git add backend/app/scoring backend/tests/scoring
git commit -m "feat: add scoring engine score_stat_line and DEFAULT_PPR ruleset"
```

---

### Task 2: Scoring engine — `score_players` and `sum_points`

**Files:**
- Modify: `backend/app/scoring/engine.py`
- Test: `backend/tests/scoring/test_engine.py` (append)

**Interfaces:**
- Consumes: `score_stat_line` (Task 1).
- Produces:
  - `score_players(player_stats: Mapping[str, Mapping[str, float]], ruleset: Mapping[str, float]) -> dict[str, Decimal]` — player_id → points.
  - `sum_points(player_ids: Iterable[str], player_points: Mapping[str, Decimal]) -> Decimal` — aggregates a subset; missing ids contribute `Decimal("0")`.

- [ ] **Step 1: Append failing tests to `backend/tests/scoring/test_engine.py`**

```python
def test_score_players_maps_each_player():
    from app.scoring.engine import score_players

    player_stats = {"a": {"rec": 5}, "b": {"rush_yd": 100, "rush_td": 1}}
    result = score_players(player_stats, DEFAULT_PPR)
    assert result == {"a": Decimal("5.00"), "b": Decimal("16.00")}


def test_sum_points_starter_subset():
    from app.scoring.engine import sum_points

    points = {"a": Decimal("5.00"), "b": Decimal("16.00"), "c": Decimal("9.50")}
    assert sum_points(["a", "c"], points) == Decimal("14.50")


def test_sum_points_missing_player_contributes_zero():
    from app.scoring.engine import sum_points

    assert sum_points(["a", "z"], {"a": Decimal("5.00")}) == Decimal("5.00")


def test_sum_points_empty_is_zero():
    from app.scoring.engine import sum_points

    assert sum_points([], {}) == Decimal("0")
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `uv run pytest tests/scoring/test_engine.py -k "score_players or sum_points" -v`
Expected: FAIL — `ImportError: cannot import name 'score_players'` / `'sum_points'`.

- [ ] **Step 3: Add the functions to `backend/app/scoring/engine.py`**

Update the imports line at the top of the file:

```python
from collections.abc import Iterable, Mapping
```

Append these functions to the end of the file:

```python
def score_players(
    player_stats: Mapping[str, Mapping[str, float]],
    ruleset: Mapping[str, float],
) -> dict[str, Decimal]:
    """Score many players at once: player_id -> points."""
    return {pid: score_stat_line(line, ruleset) for pid, line in player_stats.items()}


def sum_points(
    player_ids: Iterable[str],
    player_points: Mapping[str, Decimal],
) -> Decimal:
    """Sum the points of a subset of already-scored players.

    Used by the sync service to total a lineup (e.g. starters) or a bench from
    already-computed per-player points. Player ids absent from ``player_points``
    contribute ``Decimal("0")``.
    """
    total = Decimal("0")
    for pid in player_ids:
        total += player_points.get(pid, Decimal("0"))
    return total
```

- [ ] **Step 4: Run the full scoring suite to verify it passes**

Run: `uv run pytest tests/scoring/ -v`
Expected: PASS (all engine + rulesets tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/scoring/engine.py backend/tests/scoring/test_engine.py
git commit -m "feat: add score_players and sum_points aggregation helpers"
```

---

### Task 3: Sleeper errors + Pydantic response models

**Files:**
- Create: `backend/app/sleeper/__init__.py` (empty)
- Create: `backend/app/sleeper/errors.py`
- Create: `backend/app/sleeper/models.py`
- Create: `backend/tests/sleeper/__init__.py` (empty)
- Test: `backend/tests/sleeper/test_models.py`

**Interfaces:**
- Produces:
  - `app.sleeper.errors`: `SleeperError(Exception)`, `SleeperNotFound(SleeperError)`, `SleeperUnavailable(SleeperError)`.
  - `app.sleeper.models`: `NflState`, `SleeperLeague`, `SleeperUser`, `SleeperRosterSettings`, `SleeperRoster`, `SleeperMatchup`, `SleeperPlayer` (all Pydantic v2, `extra="ignore"`).
    - `NflState(season: str, week: int, season_type: str, leg: int | None)`
    - `SleeperLeague(league_id, name, season, status, previous_league_id, scoring_settings: dict[str,float], roster_positions: list[str])`
    - `SleeperUser(user_id, display_name, is_commissioner: bool)` — `is_commissioner` parsed from alias `is_owner` (null/absent → False)
    - `SleeperRoster(roster_id: int, owner_id: str | None, settings: SleeperRosterSettings)` with properties `points_for: float`, `points_against: float`
    - `SleeperMatchup(roster_id, matchup_id, points, players: list[str], starters: list[str], players_points: dict[str,float])`
    - `SleeperPlayer(player_id, full_name, first_name, last_name, position, team)`

- [ ] **Step 1: Create `backend/app/sleeper/__init__.py` and `backend/tests/sleeper/__init__.py`** (both empty)

- [ ] **Step 2: Create `backend/app/sleeper/errors.py`**

```python
class SleeperError(Exception):
    """Base error for the Sleeper API client."""


class SleeperNotFound(SleeperError):
    """Raised on HTTP 404 (e.g. an unknown league id). Never retried."""


class SleeperUnavailable(SleeperError):
    """Raised when the Sleeper API stays unreachable after retries (5xx / connection)."""
```

- [ ] **Step 3: Write the failing test `backend/tests/sleeper/test_models.py`**

```python
from app.sleeper.models import (
    NflState,
    SleeperLeague,
    SleeperMatchup,
    SleeperPlayer,
    SleeperRoster,
    SleeperUser,
)


def test_nfl_state_parses_and_ignores_extra():
    s = NflState.model_validate(
        {"season": "2024", "week": 5, "season_type": "regular", "leg": 5, "display_week": 6}
    )
    assert s.season == "2024"
    assert s.week == 5
    assert s.season_type == "regular"


def test_league_keeps_scoring_settings_as_float_map():
    league = SleeperLeague.model_validate(
        {
            "league_id": "1",
            "name": "Alpha",
            "scoring_settings": {"rec": 1.0, "pass_td": 4.0},
            "roster_positions": ["QB", "RB", "WR"],
            "previous_league_id": "0",
            "irrelevant": "x",
        }
    )
    assert league.scoring_settings == {"rec": 1.0, "pass_td": 4.0}
    assert league.roster_positions == ["QB", "RB", "WR"]
    assert league.previous_league_id == "0"


def test_user_is_commissioner_from_is_owner():
    commish = SleeperUser.model_validate({"user_id": "1", "display_name": "a", "is_owner": True})
    null_owner = SleeperUser.model_validate({"user_id": "2", "display_name": "b", "is_owner": None})
    absent = SleeperUser.model_validate({"user_id": "3", "display_name": "c"})
    assert commish.is_commissioner is True
    assert null_owner.is_commissioner is False
    assert absent.is_commissioner is False


def test_roster_combines_fpts_and_decimal():
    r = SleeperRoster.model_validate(
        {
            "roster_id": 1,
            "owner_id": "u",
            "settings": {
                "wins": 10,
                "losses": 3,
                "ties": 0,
                "fpts": 1450,
                "fpts_decimal": 55,
                "fpts_against": 1300,
                "fpts_against_decimal": 20,
            },
        }
    )
    assert r.settings.wins == 10
    assert r.points_for == 1450.55
    assert r.points_against == 1300.20


def test_matchup_exposes_lineup_fields():
    m = SleeperMatchup.model_validate(
        {
            "roster_id": 1,
            "matchup_id": 2,
            "points": 120.5,
            "players": ["a", "b"],
            "starters": ["a"],
            "players_points": {"a": 10.5, "b": 4.0},
        }
    )
    assert m.starters == ["a"]
    assert m.players == ["a", "b"]
    assert m.players_points["a"] == 10.5


def test_player_parses_core_fields():
    p = SleeperPlayer.model_validate(
        {"player_id": "4046", "full_name": "Patrick Mahomes", "position": "QB", "team": "KC"}
    )
    assert p.player_id == "4046"
    assert p.full_name == "Patrick Mahomes"
    assert p.position == "QB"
```

- [ ] **Step 4: Run the model test to verify it fails**

Run: `uv run pytest tests/sleeper/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sleeper.models'`.

- [ ] **Step 5: Create `backend/app/sleeper/models.py`**

```python
from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class NflState(_Base):
    season: str
    week: int
    season_type: str
    leg: int | None = None


class SleeperLeague(_Base):
    league_id: str
    name: str
    season: str | None = None
    status: str | None = None
    previous_league_id: str | None = None
    scoring_settings: dict[str, float] = Field(default_factory=dict)
    roster_positions: list[str] = Field(default_factory=list)


class SleeperUser(_Base):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    user_id: str
    display_name: str | None = None
    is_commissioner: bool = Field(default=False, alias="is_owner")

    @field_validator("is_commissioner", mode="before")
    @classmethod
    def _coerce_none_to_false(cls, value: object) -> bool:
        return bool(value) if value is not None else False


class SleeperRosterSettings(_Base):
    wins: int = 0
    losses: int = 0
    ties: int = 0
    fpts: float = 0.0
    fpts_decimal: float = 0.0
    fpts_against: float = 0.0
    fpts_against_decimal: float = 0.0


class SleeperRoster(_Base):
    roster_id: int
    owner_id: str | None = None
    settings: SleeperRosterSettings = Field(default_factory=SleeperRosterSettings)

    @property
    def points_for(self) -> float:
        return round(self.settings.fpts + self.settings.fpts_decimal / 100, 2)

    @property
    def points_against(self) -> float:
        return round(self.settings.fpts_against + self.settings.fpts_against_decimal / 100, 2)


class SleeperMatchup(_Base):
    roster_id: int
    matchup_id: int | None = None
    points: float = 0.0
    players: list[str] = Field(default_factory=list)
    starters: list[str] = Field(default_factory=list)
    players_points: dict[str, float] = Field(default_factory=dict)


class SleeperPlayer(_Base):
    player_id: str
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    position: str | None = None
    team: str | None = None
```

- [ ] **Step 6: Run the model test to verify it passes**

Run: `uv run pytest tests/sleeper/test_models.py -v`
Expected: PASS (6 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/app/sleeper/__init__.py backend/app/sleeper/errors.py backend/app/sleeper/models.py backend/tests/sleeper/__init__.py backend/tests/sleeper/test_models.py
git commit -m "feat: add Sleeper errors and Pydantic response models"
```

---

### Task 4: SleeperClient request core + retry/backoff + `get_nfl_state`

**Files:**
- Modify: `backend/pyproject.toml` (add `pytest-asyncio` dev dep + asyncio config)
- Create: `backend/app/sleeper/client.py`
- Test: `backend/tests/sleeper/test_client.py`

**Interfaces:**
- Consumes: `app.sleeper.errors`, `app.sleeper.models.NflState`.
- Produces:
  - `app.sleeper.client.SleeperClient(*, base_url=DEFAULT_BASE_URL, timeout=15.0, max_retries=3, base_backoff=0.5, players_cache_ttl=86400.0, transport=None, sleep=<async>, clock=time.monotonic)`.
  - Async lifecycle: `async with SleeperClient() as c:` / `await c.aclose()`.
  - Internal `async _get_json(path: str) -> Any` (retry/backoff + error mapping) — relied on by all endpoint methods in Tasks 5–6.
  - `async get_nfl_state() -> NflState`.
  - Module constant `DEFAULT_BASE_URL = "https://api.sleeper.app/v1"`.

- [ ] **Step 1: Add `pytest-asyncio` and async config to `backend/pyproject.toml`**

In the `[dependency-groups]` `dev` list, add `"pytest-asyncio>=0.23"`:

```toml
[dependency-groups]
dev = [
    "pytest>=8.2",
    "httpx>=0.27",
    "pytest-asyncio>=0.23",
]
```

In `[tool.pytest.ini_options]`, add the `asyncio_mode` line:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
asyncio_mode = "auto"
```

Then run: `uv sync`
Expected: `pytest-asyncio` installs without error.

- [ ] **Step 2: Write the failing test `backend/tests/sleeper/test_client.py`**

```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `uv run pytest tests/sleeper/test_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sleeper.client'`.

- [ ] **Step 4: Create `backend/app/sleeper/client.py`**

```python
import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.sleeper.errors import SleeperNotFound, SleeperUnavailable
from app.sleeper.models import NflState

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

            response.raise_for_status()
            return response.json()

    async def get_nfl_state(self) -> NflState:
        data = await self._get_json("/state/nfl")
        return NflState.model_validate(data)
```

- [ ] **Step 5: Run the client test to verify it passes**

Run: `uv run pytest tests/sleeper/test_client.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/pyproject.toml backend/app/sleeper/client.py backend/tests/sleeper/test_client.py
git commit -m "feat: add SleeperClient request core with retry/backoff and get_nfl_state"
```

---

### Task 5: SleeperClient league/users/rosters/matchups/stats endpoints

**Files:**
- Modify: `backend/app/sleeper/client.py`
- Create: `backend/tests/sleeper/fixtures/league.json`
- Create: `backend/tests/sleeper/fixtures/users.json`
- Create: `backend/tests/sleeper/fixtures/rosters.json`
- Create: `backend/tests/sleeper/fixtures/matchups.json`
- Create: `backend/tests/sleeper/fixtures/weekly_stats.json`
- Test: `backend/tests/sleeper/test_client.py` (append)

**Interfaces:**
- Consumes: `_get_json` (Task 4); models `SleeperLeague`, `SleeperUser`, `SleeperRoster`, `SleeperMatchup`.
- Produces:
  - `async get_league(league_id: str) -> SleeperLeague`
  - `async get_league_users(league_id: str) -> list[SleeperUser]`
  - `async get_league_rosters(league_id: str) -> list[SleeperRoster]`
  - `async get_matchups(league_id: str, week: int) -> list[SleeperMatchup]`
  - `async get_weekly_stats(season: str, week: int, season_type: str = "regular") -> dict[str, dict[str, float]]`

- [ ] **Step 1: Create the fixture files**

`backend/tests/sleeper/fixtures/league.json`:

```json
{
  "league_id": "987654321",
  "name": "Alpha League",
  "season": "2024",
  "status": "in_season",
  "previous_league_id": "111111111",
  "scoring_settings": {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1},
  "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]
}
```

`backend/tests/sleeper/fixtures/users.json`:

```json
[
  {"user_id": "100", "display_name": "commish", "is_owner": true},
  {"user_id": "200", "display_name": "member", "is_owner": null},
  {"user_id": "300", "display_name": "other"}
]
```

`backend/tests/sleeper/fixtures/rosters.json`:

```json
[
  {"roster_id": 1, "owner_id": "100", "settings": {"wins": 9, "losses": 4, "ties": 0, "fpts": 1521, "fpts_decimal": 40, "fpts_against": 1400, "fpts_against_decimal": 10}},
  {"roster_id": 2, "owner_id": "200", "settings": {"wins": 7, "losses": 6, "ties": 0, "fpts": 1410, "fpts_decimal": 0, "fpts_against": 1455, "fpts_against_decimal": 90}}
]
```

`backend/tests/sleeper/fixtures/matchups.json`:

```json
[
  {"roster_id": 1, "matchup_id": 1, "points": 120.5, "players": ["4046", "6794"], "starters": ["4046"], "players_points": {"4046": 24.5, "6794": 12.0}},
  {"roster_id": 2, "matchup_id": 1, "points": 99.0, "players": ["1234", "5678"], "starters": ["1234"], "players_points": {"1234": 18.0, "5678": 9.5}}
]
```

`backend/tests/sleeper/fixtures/weekly_stats.json`:

```json
{
  "4046": {"pass_yd": 305, "pass_td": 3, "pass_int": 1, "rush_yd": 12},
  "6794": {"rec": 6, "rec_yd": 88, "rec_td": 1}
}
```

- [ ] **Step 2: Append failing tests to `backend/tests/sleeper/test_client.py`**

Add these imports at the top of the file (alongside the existing imports):

```python
import json
from pathlib import Path

from app.sleeper.models import SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser

_FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(name: str):
    return json.loads((_FIXTURES / name).read_text())


def _route_client(routes: dict[str, object], **kwargs) -> SleeperClient:
    """A client whose MockTransport returns a fixture payload by URL-path suffix."""

    def handler(request):
        for suffix, payload in routes.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep, **kwargs)
```

Then append these tests:

```python
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
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `uv run pytest tests/sleeper/test_client.py -k "league or rosters or matchups or weekly_stats" -v`
Expected: FAIL — `AttributeError: 'SleeperClient' object has no attribute 'get_league'` (etc.).

- [ ] **Step 4: Add the endpoint methods to `backend/app/sleeper/client.py`**

Update the models import line:

```python
from app.sleeper.models import (
    NflState,
    SleeperLeague,
    SleeperMatchup,
    SleeperRoster,
    SleeperUser,
)
```

Append these methods to the `SleeperClient` class:

```python
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
```

- [ ] **Step 5: Run the client suite to verify it passes**

Run: `uv run pytest tests/sleeper/test_client.py -v`
Expected: PASS (all 9 tests: the 4 from Task 4 plus the 5 new).

- [ ] **Step 6: Commit**

```bash
git add backend/app/sleeper/client.py backend/tests/sleeper/test_client.py backend/tests/sleeper/fixtures
git commit -m "feat: add league/users/rosters/matchups/stats endpoints to SleeperClient"
```

---

### Task 6: SleeperClient `get_players` with cached dump

**Files:**
- Modify: `backend/app/sleeper/client.py`
- Test: `backend/tests/sleeper/test_client.py` (append)

**Interfaces:**
- Consumes: `_get_json` (Task 4); `SleeperPlayer`; the `_players_cache`, `_players_lock`, `_players_cache_ttl`, `_clock` set up in Task 4's constructor.
- Produces: `async get_players() -> dict[str, SleeperPlayer]` — fetches `/players/nfl`, caches in memory for `players_cache_ttl` seconds (clock-driven), serialized by `_players_lock`. Each player's `player_id` is taken from the dict key.

- [ ] **Step 1: Append failing tests to `backend/tests/sleeper/test_client.py`**

Add this import at the top (with the other model imports):

```python
import asyncio

from app.sleeper.models import SleeperPlayer
```

Add this small fake clock helper near the top of the file (after `_noop_sleep`):

```python
class _FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now
```

Then append these tests:

```python
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `uv run pytest tests/sleeper/test_client.py -k "players" -v`
Expected: FAIL — `AttributeError: 'SleeperClient' object has no attribute 'get_players'`.

- [ ] **Step 3: Add `get_players` and the `SleeperPlayer` import to `backend/app/sleeper/client.py`**

Add `SleeperPlayer` to the models import block:

```python
from app.sleeper.models import (
    NflState,
    SleeperLeague,
    SleeperMatchup,
    SleeperPlayer,
    SleeperRoster,
    SleeperUser,
)
```

Append this method to the `SleeperClient` class:

```python
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
```

- [ ] **Step 4: Run the client suite to verify it passes**

Run: `uv run pytest tests/sleeper/test_client.py -v`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Run the full backend suite to verify nothing regressed**

Run: `uv run pytest -v`
Expected: PASS — Plan 1's 12 tests plus all new scoring + sleeper tests, clean (the single pre-existing Starlette/httpx deprecation warning from the health test may remain; it is unrelated).

- [ ] **Step 6: Commit**

```bash
git add backend/app/sleeper/client.py backend/tests/sleeper/test_client.py
git commit -m "feat: add cached get_players to SleeperClient"
```

---

## Self-Review Notes

- **Spec coverage:** Scoring engine (`score_stat_line`/`score_players`/`sum_points`, Decimal half-up rounding) → Tasks 1–2. `DEFAULT_PPR` in Sleeper format → Task 1. Errors + Pydantic models (incl. commissioner-from-`is_owner`, fpts/decimal combination) → Task 3. Client request core + retry/backoff + typed errors → Task 4. All endpoint methods → Tasks 4–5. Cached `get_players` with TTL + concurrency lock → Task 6. Tests against `MockTransport` with recorded fixtures, no live calls → Tasks 4–6.
- **DB-free invariant:** no task imports `app.db` or `app.models`; both packages are standalone.
- **Type consistency:** `_get_json`, `_backoff`, `_players_cache`/`_players_lock`/`_clock`/`_players_cache_ttl` introduced in Task 4 are reused by Tasks 5–6 exactly as named. Model names match the spec's interface block throughout. The `_noop_sleep` / `_client` / `_route_client` / `_FakeClock` test helpers are defined once (Tasks 4–6) and reused.
- **Async config:** `asyncio_mode = "auto"` (Task 4) lets the async `test_*` functions run without per-test decorators; the sync scoring tests are unaffected.
- **Deferred (Plan 3, correctly absent here):** DB persistence, hybrid mismatch comparison/tolerance, league-scoring validation, game-window scheduling.
