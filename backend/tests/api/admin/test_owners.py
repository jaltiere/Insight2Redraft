from app.api.security import create_access_token
from app.models import AccountRole, Owner


def _la_headers(make_account):
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_create_owner_requires_token(client):
    resp = client.post("/admin/owners", json={"first_name": "A", "last_name": "B"})
    assert resp.status_code == 401


def test_create_owner_succeeds(client, admin_headers, db_session):
    resp = client.post(
        "/admin/owners",
        json={"first_name": "Jack", "last_name": "Altiere", "email": "j@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["first_name"] == "Jack"
    assert db_session.query(Owner).filter_by(email="j@example.com").count() == 1


def test_create_owner_allowed_for_any_admin(client, make_account):
    resp = client.post(
        "/admin/owners",
        json={"first_name": "L", "last_name": "A"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 201


def test_create_owner_duplicate_email_409(client, admin_headers, seed):
    seed.owner(email="dup@example.com")
    resp = client.post(
        "/admin/owners",
        json={"first_name": "X", "last_name": "Y", "email": "dup@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_list_owners_search_filters_by_q(client, admin_headers, seed):
    seed.owner(first_name="Alice", last_name="Smith")
    seed.owner(first_name="Bob", last_name="Jones")
    resp = client.get("/admin/owners", params={"q": "ali"}, headers=admin_headers)
    assert resp.status_code == 200
    assert {o["first_name"] for o in resp.json()} == {"Alice"}


def test_get_owner_includes_links_and_404(client, admin_headers, seed):
    owner = seed.owner()
    ok = client.get(f"/admin/owners/{owner.id}", headers=admin_headers)
    assert ok.status_code == 200
    assert ok.json()["sleeper_links"] == []
    assert client.get("/admin/owners/999999", headers=admin_headers).status_code == 404


def test_patch_owner_updates_fields(client, admin_headers, seed):
    owner = seed.owner(first_name="Old")
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"first_name": "New", "notes": "vip"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["first_name"] == "New"


def test_patch_owner_forbidden_for_league_admin(client, make_account, seed):
    owner = seed.owner()
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"first_name": "Nope"},
        headers=_la_headers(make_account),
    )
    assert resp.status_code == 403


def test_patch_owner_duplicate_email_409(client, admin_headers, seed):
    seed.owner(email="taken@example.com")
    owner = seed.owner(first_name="Movable")
    resp = client.patch(
        f"/admin/owners/{owner.id}",
        json={"email": "taken@example.com"},
        headers=admin_headers,
    )
    assert resp.status_code == 409


def test_patch_unknown_owner_404(client, admin_headers):
    resp = client.patch(
        "/admin/owners/999999", json={"first_name": "X"}, headers=admin_headers
    )
    assert resp.status_code == 404
