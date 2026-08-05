import pytest
from fastapi.testclient import TestClient

from app.api.security import create_access_token, hash_password
from app.db import get_db
from app.main import create_app
from app.models import Account, AccountRole


@pytest.fixture()
def app(db_session):
    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    return application


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def make_account(db_session):
    def _make(
        email: str,
        password: str,
        role: AccountRole = AccountRole.SUPER_ADMIN,
        owner_id: int | None = None,
    ) -> Account:
        account = Account(
            email=email,
            password_hash=hash_password(password),
            role=role,
            owner_id=owner_id,
        )
        db_session.add(account)
        db_session.flush()
        return account

    return _make


@pytest.fixture()
def super_admin(make_account):
    return make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)


@pytest.fixture()
def admin_headers(super_admin):
    token = create_access_token(super_admin.id, super_admin.role)
    return {"Authorization": f"Bearer {token}"}
