import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient

from app.api.deps import require_league_admin, require_super_admin
from app.api.security import create_access_token
from app.models import Account, AccountRole, League, LeagueAdminGrant, Season


@pytest.fixture()
def league(db_session):
    season = Season(year=2099)
    db_session.add(season)
    db_session.flush()
    lg = League(season_id=season.id, sleeper_league_id="999", name="Grant Test League")
    db_session.add(lg)
    db_session.flush()
    return lg


def _auth_header(account) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


# require_super_admin — direct calls

def test_require_super_admin_passes_super_admin(make_account):
    account = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    assert require_super_admin(account=account) is account


def test_require_super_admin_rejects_league_admin_with_403(make_account):
    account = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    with pytest.raises(HTTPException) as exc:
        require_super_admin(account=account)
    assert exc.value.status_code == 403


# require_super_admin — wired through a real route end-to-end

def test_require_super_admin_route_enforcement(app, make_account):
    @app.get("/_test/super-only")
    def super_only(account: Account = Depends(require_super_admin)) -> dict[str, int]:
        return {"id": account.id}

    client = TestClient(app)
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)

    ok = client.get("/_test/super-only", headers=_auth_header(root))
    assert ok.status_code == 200
    assert ok.json() == {"id": root.id}

    forbidden = client.get("/_test/super-only", headers=_auth_header(la))
    assert forbidden.status_code == 403


# require_league_admin — direct calls on the factory's dependency

def test_league_admin_with_grant_passes(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=admin.id, league_id=league.id))
    db_session.flush()
    dep = require_league_admin(league.id)
    assert dep(account=admin, db=db_session) is admin


def test_league_admin_without_grant_rejected_403(db_session, make_account, league):
    admin = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    dep = require_league_admin(league.id)
    with pytest.raises(HTTPException) as exc:
        dep(account=admin, db=db_session)
    assert exc.value.status_code == 403


def test_super_admin_passes_any_league_without_grant(db_session, make_account, league):
    root = make_account("root@example.com", "pw", role=AccountRole.SUPER_ADMIN)
    dep = require_league_admin(league.id)
    assert dep(account=root, db=db_session) is root
