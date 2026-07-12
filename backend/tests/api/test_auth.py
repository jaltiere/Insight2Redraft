from app.api.security import create_access_token, decode_access_token


def _auth_header(account) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def test_login_success_returns_usable_token(client, make_account):
    make_account("admin@example.com", "correct-horse")
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "correct-horse"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    claims = decode_access_token(body["access_token"])
    assert claims["role"] == "super_admin"


def test_login_wrong_password_returns_401(client, make_account):
    make_account("admin@example.com", "correct-horse")
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_login_unknown_email_indistinguishable_from_wrong_password(client, make_account):
    make_account("admin@example.com", "correct-horse")
    wrong_pw = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )
    unknown = client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )
    assert unknown.status_code == 401
    assert unknown.json() == wrong_pw.json()


def test_health_stays_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_me_returns_current_account(client, make_account):
    account = make_account("admin@example.com", "correct-horse")
    resp = client.get("/auth/me", headers=_auth_header(account))
    assert resp.status_code == 200
    assert resp.json() == {
        "id": account.id,
        "email": "admin@example.com",
        "role": "super_admin",
        "owner_id": None,
    }


def test_me_without_token_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"] == "Bearer"


def test_me_with_garbage_token_returns_401(client):
    resp = client.get("/auth/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_me_with_token_for_deleted_account_returns_401(client, make_account, db_session):
    account = make_account("ghost@example.com", "pw")
    headers = _auth_header(account)
    db_session.delete(account)
    db_session.flush()
    resp = client.get("/auth/me", headers=headers)
    assert resp.status_code == 401
