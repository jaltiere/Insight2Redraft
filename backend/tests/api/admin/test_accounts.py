from app.api.security import create_access_token
from app.models import Account, AccountRole, LeagueAdminGrant


def _la_headers(make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_create_account_requires_token(client):
    resp = client.post("/admin/accounts", json={"email": "x@e.com", "password": "pw"})
    assert resp.status_code == 401


def test_create_account_forbidden_for_league_admin(client, make_account):
    resp = client.post(
        "/admin/accounts",
        json={"email": "x@e.com", "password": "pw"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 403


def test_create_account_is_league_admin_and_hides_hash(client, admin_headers, db_session):
    resp = client.post(
        "/admin/accounts",
        json={"email": "new@e.com", "password": "pw"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "league_admin"
    assert body["grants"] == []
    assert "password_hash" not in body
    row = db_session.query(Account).filter_by(email="new@e.com").one()
    assert row.role is AccountRole.LEAGUE_ADMIN


def test_create_account_duplicate_email_409(client, admin_headers, make_account):
    make_account("dup@e.com", "pw")
    resp = client.post(
        "/admin/accounts",
        json={"email": "dup@e.com", "password": "pw"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_create_account_unknown_owner_422(client, admin_headers):
    resp = client.post(
        "/admin/accounts",
        json={"email": "o@e.com", "password": "pw", "owner_id": 999999},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_create_account_with_owner(client, admin_headers, seed):
    owner = seed.owner()
    resp = client.post(
        "/admin/accounts",
        json={"email": "own@e.com", "password": "pw", "owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["owner_id"] == owner.id


def test_list_accounts_includes_grants(client, admin_headers, db_session, seed, make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    resp = client.get("/admin/accounts", headers=admin_headers)
    assert resp.status_code == 200
    by_email = {a["email"]: a for a in resp.json()}
    assert by_email["la@e.com"]["grants"] == [
        {"league_id": league.id, "league_name": "Alpha"}
    ]


def test_reset_password_then_login(client, admin_headers, make_account):
    acct = make_account("reset@e.com", "oldpw", role=AccountRole.LEAGUE_ADMIN)
    resp = client.patch(
        f"/admin/accounts/{acct.id}", json={"password": "newpw"}, headers=admin_headers
    )
    assert resp.status_code == 200
    assert client.post(
        "/auth/login", json={"email": "reset@e.com", "password": "newpw"}
    ).status_code == 200
    assert client.post(
        "/auth/login", json={"email": "reset@e.com", "password": "oldpw"}
    ).status_code == 401


def test_reset_password_unknown_404(client, admin_headers):
    resp = client.patch(
        "/admin/accounts/999999", json={"password": "x"}, headers=admin_headers
    )
    assert resp.status_code == 404


def test_delete_account_cascades_grants(client, admin_headers, db_session, seed, make_account):
    la = make_account("gone@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()
    la_id = la.id
    resp = client.delete(f"/admin/accounts/{la_id}", headers=admin_headers)
    assert resp.status_code == 204
    assert db_session.get(Account, la_id) is None
    assert db_session.query(LeagueAdminGrant).filter_by(account_id=la_id).count() == 0


def test_delete_unknown_account_404(client, admin_headers):
    assert client.delete("/admin/accounts/999999", headers=admin_headers).status_code == 404


def test_delete_last_super_admin_409(client, admin_headers, super_admin):
    # super_admin is the only SUPER_ADMIN (admin_headers is its token)
    resp = client.delete(f"/admin/accounts/{super_admin.id}", headers=admin_headers)
    assert resp.status_code == 409
