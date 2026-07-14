def test_league_standings_ordered_by_winpct_then_points(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    # Insert deliberately out of standings order.
    low = seed.team(league, wins=1, losses=3, points_for=90)
    high = seed.team(league, wins=3, losses=1, points_for=120)
    tie_pf = seed.team(league, wins=3, losses=1, points_for=150)  # same record, more PF
    winless = seed.team(league, wins=0, losses=0, ties=0, points_for=200)  # no games -> last
    resp = client.get(f"/leagues/{league.id}")
    assert resp.status_code == 200
    order = [t["team_id"] for t in resp.json()["standings"]]
    assert order == [tie_pf.id, high.id, low.id, winless.id]


def test_league_includes_owner_of_record_and_null_owner(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    owner = seed.owner(first_name="Jack", last_name="Altiere", display_name="Commish")
    seed.team(league, owner=owner, wins=2, losses=0, points_for=100)
    seed.team(league, owner=None, wins=1, losses=1, points_for=80)
    body = client.get(f"/leagues/{league.id}").json()
    owners = [t["owner"] for t in body["standings"]]
    assert owners[0] == {
        "id": owner.id, "first_name": "Jack", "last_name": "Altiere",
        "display_name": "Commish", "avatar_url": None,
    }
    assert owners[1] is None


def test_league_unknown_returns_404(client):
    assert client.get("/leagues/999999").status_code == 404


def test_team_detail_weekly_scores_ordered_by_week(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, wins=1, losses=0, points_for=100)
    seed.weekly(team, week=2, sleeper_points=110)
    seed.weekly(team, week=1, sleeper_points=100)
    body = client.get(f"/teams/{team.id}").json()
    assert body["league_name"] == "Alpha"
    assert body["season_year"] == 2025
    assert [(w["week"], w["points"]) for w in body["weekly_scores"]] == [(1, 100.0), (2, 110.0)]


def test_team_unknown_returns_404(client):
    assert client.get("/teams/999999").status_code == 404


def test_public_league_and_team_hide_scoring_internals(client, seed):
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    owner = seed.owner(email="secret@example.com", notes="internal note")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    seed.weekly(team, week=1, sleeper_points=100, recomputed_points=95,
                bench_points=30, mismatch_flag=True)
    forbidden = ("recomputed_points", "bench_points", "mismatch_flag",
                 "email", "notes", "secret@example.com", "internal note")
    for path in (f"/leagues/{league.id}", f"/teams/{team.id}"):
        text = client.get(path).text
        for token in forbidden:
            assert token not in text
