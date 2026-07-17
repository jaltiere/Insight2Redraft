import httpx

from app.api.deps import get_sleeper_client
from app.models import League, ScoringRuleset, Season, Team
from app.sleeper.client import SleeperClient
from tests.sync.conftest import load_fixture, route_client

_MATCHING = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}


def _league_routes():
    return {
        "/league/987654321/users": load_fixture("users.json"),
        "/league/987654321/rosters": load_fixture("rosters.json"),
        "/league/987654321": load_fixture("league.json"),
    }


async def _noop_sleep(_seconds: float) -> None:
    return None


def _failing_client(status: int) -> SleeperClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={})

    return SleeperClient(transport=httpx.MockTransport(handler), sleep=_noop_sleep)


def _use_client(app, client_obj):
    app.dependency_overrides[get_sleeper_client] = lambda: client_obj


def test_enter_league_validated_true(app, client, admin_headers, db_session, seed):
    rs = ScoringRuleset(name="match", rules=_MATCHING)
    db_session.add(rs)
    db_session.flush()
    season = seed.season(2024, scoring_ruleset_id=rs.id)
    _use_client(app, route_client(_league_routes()))

    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Alpha League"
    assert body["scoring_validated"] is True
    assert body["diffs"] == []
    assert {t["sleeper_roster_id"] for t in body["teams"]} == {1, 2}
    assert db_session.query(League).filter_by(sleeper_league_id="987654321").count() == 1


def test_enter_league_reports_diffs(app, client, admin_headers, db_session, seed):
    rs = ScoringRuleset(name="mismatch", rules={**_MATCHING, "pass_td": 6.0})
    db_session.add(rs)
    db_session.flush()
    season = seed.season(2024, scoring_ruleset_id=rs.id)
    _use_client(app, route_client(_league_routes()))

    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["scoring_validated"] is False
    assert {
        "category": "pass_td", "league_value": 4.0, "platform_value": 6.0
    } in body["diffs"]


def test_enter_league_idempotent(app, client, admin_headers, db_session, seed):
    season = seed.season(2024)
    _use_client(app, route_client(_league_routes()))
    for _ in range(2):
        resp = client.post(
            f"/admin/seasons/{season.id}/leagues",
            json={"sleeper_league_id": "987654321"},
            headers=admin_headers,
        )
        assert resp.status_code == 201
    assert db_session.query(League).filter_by(sleeper_league_id="987654321").count() == 1


def test_enter_league_unknown_season_404(app, client, admin_headers):
    _use_client(app, route_client(_league_routes()))
    resp = client.post(
        "/admin/seasons/999999/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_enter_league_sleeper_not_found_422(app, client, admin_headers, seed):
    season = seed.season(2024)
    _use_client(app, route_client({}))  # every path -> 404 -> SleeperNotFound
    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "000"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_enter_league_sleeper_unavailable_502(app, client, admin_headers, seed):
    season = seed.season(2024)
    _use_client(app, _failing_client(500))
    resp = client.post(
        f"/admin/seasons/{season.id}/leagues",
        json={"sleeper_league_id": "987654321"},
        headers=admin_headers,
    )
    assert resp.status_code == 502


def test_resync_setup_returns_fresh_result(app, client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = League(season_id=season.id, sleeper_league_id="987654321", name="old name")
    db_session.add(league)
    db_session.flush()
    _use_client(app, route_client(_league_routes()))

    resp = client.post(f"/admin/leagues/{league.id}/resync-setup", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["league_id"] == league.id
    assert body["name"] == "Alpha League"  # refreshed from Sleeper


def test_resync_unknown_league_404(app, client, admin_headers):
    _use_client(app, route_client(_league_routes()))
    resp = client.post("/admin/leagues/999999/resync-setup", headers=admin_headers)
    assert resp.status_code == 404


def test_delete_league_cascades_teams(client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    seed.team(league, wins=1, losses=0, points_for=100)
    league_id = league.id

    resp = client.delete(f"/admin/leagues/{league_id}", headers=admin_headers)
    assert resp.status_code == 204
    assert db_session.get(League, league_id) is None
    assert db_session.query(Team).filter_by(league_id=league_id).count() == 0


def test_delete_unknown_league_404(client, admin_headers):
    resp = client.delete("/admin/leagues/999999", headers=admin_headers)
    assert resp.status_code == 404
