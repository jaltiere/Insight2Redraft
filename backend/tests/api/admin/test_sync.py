import httpx

from app.api.deps import get_sleeper_client
from app.api.security import create_access_token
from app.models import AccountRole, LeagueAdminGrant, ScoringRuleset, SeasonStatus
from app.sleeper.client import SleeperClient
from tests.sync.conftest import load_fixture, route_client

MATCHING_RULESET = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}
NFL_STATE = {"season": "2024", "week": 5, "season_type": "regular"}


def _sync_routes():
    return {
        "/state/nfl": NFL_STATE,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
    }


async def _noop_sleep(_seconds: float) -> None:
    return None


def _failing_client() -> SleeperClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


def _use_client(app, client_obj):
    app.dependency_overrides[get_sleeper_client] = lambda: client_obj


def _headers(account):
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def _regular_league(seed, db_session, *, year=2024, status=SeasonStatus.REGULAR):
    rs = ScoringRuleset(name="match", rules=MATCHING_RULESET)
    db_session.add(rs)
    db_session.flush()
    season = seed.season(year, status=status, scoring_ruleset_id=rs.id)
    league = seed.league(season, name="Alpha", sleeper_league_id="987654321")
    return season, league


def test_sync_now_success(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    _use_client(app, route_client(_sync_routes()))
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["league_id"] == league.id
    assert body["week"] == 5
    assert body["teams_synced"] == 2
    assert body["rosters_skipped"] == 0
    assert isinstance(body["mismatches"], int)


def test_sync_now_unknown_league_404(app, client, admin_headers):
    _use_client(app, route_client({"/state/nfl": NFL_STATE}))
    resp = client.post("/admin/leagues/999999/sync", headers=admin_headers)
    assert resp.status_code == 404


def test_sync_now_setup_season_409(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session, status=SeasonStatus.SETUP)
    _use_client(app, route_client(_sync_routes()))
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 409


def test_sync_now_non_current_season_409(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session, year=2023)
    _use_client(app, route_client(_sync_routes()))  # nfl_state.season == "2024"
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 409


def test_sync_now_sleeper_failure_502(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    _use_client(app, _failing_client())
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 502


def test_sync_now_sleeper_not_found_422(app, client, admin_headers, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    # Only nfl_state is routed; matchups/rosters/stats 404 -> SleeperNotFound -> 422
    _use_client(app, route_client({"/state/nfl": NFL_STATE}))
    resp = client.post(f"/admin/leagues/{league.id}/sync", headers=admin_headers)
    assert resp.status_code == 422


def test_sync_now_league_admin_scope(app, client, db_session, seed, make_account):
    _season, league = _regular_league(seed, db_session)
    other_season = seed.season(2099, status=SeasonStatus.REGULAR)
    other = seed.league(other_season, name="Beta", sleeper_league_id="222")
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    _use_client(app, route_client(_sync_routes()))
    ok = client.post(f"/admin/leagues/{league.id}/sync", headers=_headers(la))
    assert ok.status_code == 200
    forbidden = client.post(f"/admin/leagues/{other.id}/sync", headers=_headers(la))
    assert forbidden.status_code == 403


def test_sync_now_requires_token(app, client, db_session, seed):
    _season, league = _regular_league(seed, db_session)
    assert client.post(f"/admin/leagues/{league.id}/sync").status_code == 401
