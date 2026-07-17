from app.api.security import create_access_token
from app.models import AccountRole, Season, SeasonStatus


def test_create_season_requires_token(client):
    resp = client.post("/admin/seasons", json={"year": 2025})
    assert resp.status_code == 401


def test_create_season_forbidden_for_league_admin(client, make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    headers = {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}
    resp = client.post("/admin/seasons", json={"year": 2025}, headers=headers)
    assert resp.status_code == 403


def test_create_season_succeeds_for_super_admin(client, admin_headers, db_session):
    resp = client.post(
        "/admin/seasons",
        json={"year": 2025, "playoff_field_per_league": 3, "nfl_playoff_weeks": [15, 16, 17]},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["year"] == 2025
    assert body["status"] == "setup"
    assert body["playoff_field_per_league"] == 3
    row = db_session.query(Season).filter_by(year=2025).one()
    assert row.nfl_playoff_weeks == [15, 16, 17]


def test_create_season_duplicate_year_returns_409(client, admin_headers, seed):
    seed.season(2025, status=SeasonStatus.REGULAR)
    resp = client.post("/admin/seasons", json={"year": 2025}, headers=admin_headers)
    assert resp.status_code == 409


def test_patch_season_updates_fields(client, admin_headers, seed):
    season = seed.season(2025, status=SeasonStatus.SETUP)
    resp = client.patch(
        f"/admin/seasons/{season.id}",
        json={"status": "regular", "playoff_field_per_league": 4},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "regular"
    assert body["playoff_field_per_league"] == 4


def test_patch_unknown_season_returns_404(client, admin_headers):
    resp = client.patch("/admin/seasons/999999", json={"status": "regular"}, headers=admin_headers)
    assert resp.status_code == 404
