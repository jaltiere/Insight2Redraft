from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import League, Season, Team, WeeklyScore, Player


def _make_team(db_session) -> Team:
    season = Season(year=2027)
    league = League(sleeper_league_id="555", name="Beta League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()
    team = Team(league_id=league.id, sleeper_roster_id=1)
    db_session.add(team)
    db_session.flush()
    return team


def test_weekly_score_roundtrip(db_session):
    team = _make_team(db_session)
    score = WeeklyScore(
        team_id=team.id,
        week=15,
        sleeper_points=Decimal("120.50"),
        recomputed_points=Decimal("120.50"),
        bench_points=Decimal("45.20"),
    )
    db_session.add(score)
    db_session.commit()

    loaded = db_session.query(WeeklyScore).filter_by(team_id=team.id, week=15).one()
    assert loaded.sleeper_points == Decimal("120.50")
    assert loaded.bench_points == Decimal("45.20")
    assert loaded.mismatch_flag is False
    assert loaded.is_final is False


def test_weekly_score_unique_team_week(db_session):
    team = _make_team(db_session)
    db_session.add(WeeklyScore(team_id=team.id, week=15, sleeper_points=Decimal("100")))
    db_session.commit()
    db_session.add(WeeklyScore(team_id=team.id, week=15, sleeper_points=Decimal("101")))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_player_unique_sleeper_id(db_session):
    db_session.add(Player(sleeper_player_id="4046", full_name="Patrick Mahomes", position="QB"))
    db_session.commit()
    db_session.add(Player(sleeper_player_id="4046", full_name="Dup"))
    with pytest.raises(IntegrityError):
        db_session.commit()
