from decimal import Decimal

from app.api.security import create_access_token
from app.models import (
    AccountRole,
    Bracket,
    BracketSeed,
    BracketStatus,
    SeasonStatus,
    WeeklyScore,
)


def _playoff_season_4(seed):
    season = seed.season(
        2024, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))
    return season


def _la_headers(make_account):
    la = make_account("la@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    return {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}


def test_generate_requires_super_admin(client, seed, make_account):
    season = _playoff_season_4(seed)
    assert client.post(f"/admin/seasons/{season.id}/bracket").status_code == 401
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=_la_headers(make_account)
    ).status_code == 403


def test_generate_success(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    resp = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    assert body["size"] == 4
    assert len(body["seeds"]) == 4
    assert len([m for m in body["matchups"] if not m["bye"]]) == 2


def test_generate_season_not_playoffs_409(client, admin_headers, seed):
    season = seed.season(
        2030, status=SeasonStatus.REGULAR,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 409


def test_generate_unknown_season_404(client, admin_headers):
    assert client.post("/admin/seasons/999999/bracket", headers=admin_headers).status_code == 404


def test_generate_too_few_teams_422(client, admin_headers, seed):
    season = seed.season(
        2031, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=5, losses=8, points_for=Decimal("1000"))
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 422


def test_regenerate_replaces_pending(client, admin_headers, db_session, seed):
    season = _playoff_season_4(seed)
    first = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).json()
    second = client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).json()
    assert second["status"] == "pending"
    assert first["id"] != second["id"]
    assert db_session.query(Bracket).filter_by(season_id=season.id).count() == 1


def test_generate_when_active_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket", headers=admin_headers
    ).status_code == 409


def test_approve_flips_to_active_then_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    resp = client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers
    ).status_code == 409


def test_approve_unknown_bracket_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers
    ).status_code == 404


def test_admin_read_returns_pending_and_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.get(f"/admin/seasons/{season.id}/bracket", headers=admin_headers).status_code == 404
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    resp = client.get(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


def _active_season_with_bracket(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)
    return season


def test_finalize_round_advances(client, admin_headers, db_session, seed):
    season = _active_season_with_bracket(client, admin_headers, seed)
    bracket = db_session.query(Bracket).filter_by(season_id=season.id).one()
    by_seed = {s.seed: s.team_id for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)}
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        db_session.add(
            WeeklyScore(
                team_id=by_seed[s], week=15,
                sleeper_points=Decimal(pts), recomputed_points=Decimal(pts),
                bench_points=Decimal("0"),
            )
        )
    db_session.commit()

    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert 2 in {m["round"] for m in body["matchups"]}  # next round created


def test_finalize_scores_not_synced_409(client, admin_headers, seed):
    season = _active_season_with_bracket(client, admin_headers, seed)
    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 409


def test_finalize_not_active_409(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)  # PENDING, unapproved
    resp = client.post(f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers)
    assert resp.status_code == 409


def test_finalize_unknown_bracket_404(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/finalize-round", headers=admin_headers
    ).status_code == 404


def test_finalize_requires_super_admin(client, seed, make_account):
    season = _playoff_season_4(seed)
    assert client.post(f"/admin/seasons/{season.id}/bracket/finalize-round").status_code == 401
    la = make_account("finla@e.com", "pw", role=AccountRole.LEAGUE_ADMIN)
    headers = {"Authorization": f"Bearer {create_access_token(la.id, la.role)}"}
    assert client.post(
        f"/admin/seasons/{season.id}/bracket/finalize-round", headers=headers
    ).status_code == 403
