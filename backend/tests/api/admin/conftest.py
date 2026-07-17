import pytest

from app.api.security import create_access_token
from app.models import AccountRole


@pytest.fixture()
def super_admin(make_account):
    return make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)


@pytest.fixture()
def admin_headers(super_admin):
    token = create_access_token(super_admin.id, super_admin.role)
    return {"Authorization": f"Bearer {token}"}
