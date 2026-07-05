from app.api.security import decode_access_token


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
