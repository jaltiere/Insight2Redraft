from decimal import Decimal

from app.models import Bracket, BracketStatus, SeasonStatus


def _playoff_season_4(seed):
    season = seed.season(
        2024, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="Alpha")
    lb = seed.league(season, name="Beta")
    owner = seed.owner(first_name="Jack", last_name="A")
    seed.team(la, owner=owner, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))
    return season


def _generate_and_approve(client, admin_headers, season):
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)
    client.post(f"/admin/seasons/{season.id}/bracket/approve", headers=admin_headers)


def test_public_bracket_404_when_absent(client, seed):
    season = _playoff_season_4(seed)
    assert client.get(f"/seasons/{season.id}/bracket").status_code == 404


def test_public_bracket_404_when_pending(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    client.post(f"/admin/seasons/{season.id}/bracket", headers=admin_headers)  # PENDING
    assert client.get(f"/seasons/{season.id}/bracket").status_code == 404


def test_public_bracket_visible_after_approval(client, admin_headers, seed):
    season = _playoff_season_4(seed)
    _generate_and_approve(client, admin_headers, season)
    resp = client.get(f"/seasons/{season.id}/bracket")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["size"] == 4
    assert len(body["seeds"]) == 4
    assert len(body["rounds"]) == 1
    rnd = body["rounds"][0]
    assert rnd["round"] == 1 and rnd["nfl_week"] == 15
    assert len(rnd["matchups"]) == 2
    seed1 = next(s for s in body["seeds"] if s["seed"] == 1)
    assert seed1["league_name"] == "Alpha"
    assert seed1["owner"]["first_name"] == "Jack"
    m = rnd["matchups"][0]
    assert m["team_a_score"] is None and m["team_b_score"] is None


def test_public_bracket_visible_when_complete(client, admin_headers, db_session, seed):
    season = _playoff_season_4(seed)
    _generate_and_approve(client, admin_headers, season)
    bracket = db_session.query(Bracket).filter_by(season_id=season.id).one()
    bracket.status = BracketStatus.COMPLETE
    db_session.commit()
    resp = client.get(f"/seasons/{season.id}/bracket")
    assert resp.status_code == 200
    assert resp.json()["status"] == "complete"
