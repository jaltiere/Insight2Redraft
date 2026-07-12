from app.models import SeasonStatus


def test_list_seasons_newest_year_first(client, seed):
    seed.season(2024, status=SeasonStatus.COMPLETE)
    seed.season(2025, status=SeasonStatus.REGULAR)
    resp = client.get("/seasons")
    assert resp.status_code == 200
    years = [s["year"] for s in resp.json()]
    assert years == [2025, 2024]


def test_list_seasons_empty(client):
    resp = client.get("/seasons")
    assert resp.status_code == 200
    assert resp.json() == []


def test_season_detail_embeds_leagues(client, seed):
    season = seed.season(2025)
    seed.league(season, name="Alpha", scoring_validated=True)
    seed.league(season, name="Beta")
    resp = client.get(f"/seasons/{season.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["year"] == 2025
    assert body["status"] == "regular"
    names = sorted(lg["name"] for lg in body["leagues"])
    assert names == ["Alpha", "Beta"]
    assert {lg["name"]: lg["scoring_validated"] for lg in body["leagues"]}["Alpha"] is True


def test_season_detail_unknown_returns_404(client):
    resp = client.get("/seasons/999999")
    assert resp.status_code == 404
