from app.history.service import owner_best_weekly, owner_season_records
from app.models import SeasonStatus


def test_owner_season_records_across_leagues_and_years(db_session, seed):
    owner = seed.owner()
    s2024 = seed.season(2024, status=SeasonStatus.COMPLETE)
    s2025 = seed.season(2025)
    la = seed.league(s2024, name="Alpha")
    lb = seed.league(s2025, name="Beta")
    seed.team(la, owner=owner, wins=8, losses=6, points_for=1500, league_finish=3)
    seed.team(lb, owner=owner, wins=10, losses=4, points_for=1700, league_finish=1)

    rows = owner_season_records(db_session, owner.id)

    assert [(r.season_year, r.league_name) for r in rows] == [(2025, "Beta"), (2024, "Alpha")]
    assert rows[0].wins == 10 and rows[0].league_finish == 1
    assert rows[1].points_for == 1500.0


def test_owner_season_records_empty_for_owner_without_teams(db_session, seed):
    owner = seed.owner()
    assert owner_season_records(db_session, owner.id) == []


def test_owner_best_weekly_ranks_and_limits(db_session, seed):
    owner = seed.owner()
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    for week, pts in [(1, 90), (2, 150), (3, 120), (4, 60)]:
        seed.weekly(team, week=week, sleeper_points=pts)

    rows = owner_best_weekly(db_session, owner.id, limit=2)

    assert [(r.week, r.points) for r in rows] == [(2, 150.0), (3, 120.0)]
    assert rows[0].season_year == 2025 and rows[0].league_name == "Alpha"


def test_owner_best_weekly_default_limit_is_five(db_session, seed):
    owner = seed.owner()
    season = seed.season(2025)
    league = seed.league(season, name="Alpha")
    team = seed.team(league, owner=owner, wins=1, losses=0, points_for=100)
    for week in range(1, 8):  # 7 weeks
        seed.weekly(team, week=week, sleeper_points=week * 10)

    rows = owner_best_weekly(db_session, owner.id)
    assert len(rows) == 5
    assert rows[0].points == 70.0  # week 7, highest
