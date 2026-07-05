import pytest
from fastapi.testclient import TestClient

from app.api.security import hash_password
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
