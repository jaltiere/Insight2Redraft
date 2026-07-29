from app.api.security import create_access_token
from app.models import AccountRole, LeagueAdminGrant, OwnerSleeperLink


def _headers(account):
    return {"Authorization": f"Bearer {create_access_token(account.id, account.role)}"}


def _league_with_team(seed, *, sleeper_user_id="100", display="commish"):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    team = seed.team(
        league, sleeper_user_id=sleeper_user_id, sleeper_display_name=display
    )
    return season, league, team


def test_worksheet_lists_rows(client, admin_headers, seed):
    _season, league, _team = _league_with_team(seed)
    resp = client.get(f"/admin/leagues/{league.id}/teams", headers=admin_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["sleeper_display_name"] == "commish"
    assert rows[0]["owner"] is None


def test_worksheet_unknown_league_404(client, admin_headers):
    assert client.get("/admin/leagues/999999/teams", headers=admin_headers).status_code == 404


def test_assign_sets_owner_and_link(client, admin_headers, db_session, seed):
    _season, league, team = _league_with_team(seed)
    owner = seed.owner(first_name="Jack")
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["owner"]["id"] == owner.id
    link = db_session.query(OwnerSleeperLink).filter_by(
        sleeper_user_id="100", season=2024
    ).one()
    assert link.owner_id == owner.id
    assert link.sleeper_display_name == "commish"


def test_reassign_updates_same_link(client, admin_headers, db_session, seed):
    _season, league, team = _league_with_team(seed)
    first = seed.owner(first_name="First")
    second = seed.owner(first_name="Second")
    client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": first.id}, headers=admin_headers,
    )
    client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": second.id}, headers=admin_headers,
    )
    links = db_session.query(OwnerSleeperLink).filter_by(
        sleeper_user_id="100", season=2024
    ).all()
    assert len(links) == 1
    assert links[0].owner_id == second.id


def test_assign_unknown_owner_422(client, admin_headers, seed):
    _season, league, team = _league_with_team(seed)
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": 999999},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_assign_team_not_in_league_404(client, admin_headers, seed):
    season, _league, team = _league_with_team(seed)
    other = seed.league(season, name="Beta")
    resp = client.patch(
        f"/admin/leagues/{other.id}/teams/{team.id}",
        json={"owner_id": 1},
        headers=admin_headers,
    )
    assert resp.status_code == 404


def test_assign_null_sleeper_user_skips_link(client, admin_headers, db_session, seed):
    season = seed.season(2024)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, sleeper_user_id=None, sleeper_display_name=None)
    owner = seed.owner()
    resp = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["owner"]["id"] == owner.id
    assert db_session.query(OwnerSleeperLink).count() == 0


def test_league_admin_maps_own_league_only(client, db_session, seed, make_account):
    season, league, team = _league_with_team(seed)
    other = seed.league(season, name="Beta")
    other_team = seed.team(other, sleeper_user_id="200", sleeper_display_name="member")
    owner = seed.owner()
    la = make_account("la@example.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(LeagueAdminGrant(account_id=la.id, league_id=league.id))
    db_session.flush()

    ok = client.patch(
        f"/admin/leagues/{league.id}/teams/{team.id}",
        json={"owner_id": owner.id}, headers=_headers(la),
    )
    assert ok.status_code == 200

    forbidden = client.patch(
        f"/admin/leagues/{other.id}/teams/{other_team.id}",
        json={"owner_id": owner.id}, headers=_headers(la),
    )
    assert forbidden.status_code == 403


def test_mapping_requires_token(client, seed):
    _season, league, _team = _league_with_team(seed)
    assert client.get(f"/admin/leagues/{league.id}/teams").status_code == 401
