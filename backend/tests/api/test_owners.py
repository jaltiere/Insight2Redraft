def test_owner_profile_identity_records_and_best_weekly(client, seed):
    owner = seed.owner(first_name="Jack", last_name="Altiere", display_name="Commish")
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=10, losses=4, points_for=1700, league_finish=1)
    seed.weekly(team, week=1, sleeper_points=120)
    seed.weekly(team, week=2, sleeper_points=150)

    body = client.get(f"/owners/{owner.id}").json()

    assert body["first_name"] == "Jack"
    assert body["display_name"] == "Commish"
    assert len(body["season_records"]) == 1
    assert body["season_records"][0] == {
        "season_year": 2025, "league_id": league.id, "league_name": "Alpha",
        "wins": 10, "losses": 4, "ties": 0,
        "points_for": 1700.0, "points_against": 0.0, "league_finish": 1,
    }
    assert [(w["week"], w["points"]) for w in body["best_weekly"]] == [(2, 150.0), (1, 120.0)]


def test_owner_profile_empty_history(client, seed):
    owner = seed.owner()
    body = client.get(f"/owners/{owner.id}").json()
    assert body["season_records"] == []
    assert body["best_weekly"] == []


def test_owner_unknown_returns_404(client):
    assert client.get("/owners/999999").status_code == 404


def test_owner_profile_hides_pii(client, seed):
    owner = seed.owner(email="secret@example.com", notes="internal note")
    text = client.get(f"/owners/{owner.id}").text
    for token in ("email", "notes", "secret@example.com", "internal note"):
        assert token not in text
