from decimal import Decimal

from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    League,
    QualifiedVia,
    Season,
    Team,
)


def _make_two_teams(db_session, season):
    league = League(sleeper_league_id="111", name="Gamma League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()
    t1 = Team(league_id=league.id, sleeper_roster_id=1)
    t2 = Team(league_id=league.id, sleeper_roster_id=2)
    db_session.add_all([t1, t2])
    db_session.flush()
    return t1, t2


def test_bracket_with_seeds_and_matchup(db_session):
    season = Season(year=2028)
    t1, t2 = _make_two_teams(db_session, season)

    bracket = Bracket(season_id=season.id, size=8, status=BracketStatus.PENDING)
    db_session.add(bracket)
    db_session.flush()

    db_session.add_all(
        [
            BracketSeed(bracket_id=bracket.id, team_id=t1.id, seed=1, qualified_via=QualifiedVia.AUTO),
            BracketSeed(bracket_id=bracket.id, team_id=t2.id, seed=8, qualified_via=QualifiedVia.AUTO),
        ]
    )
    matchup = BracketMatchup(
        bracket_id=bracket.id,
        round=1,
        nfl_week=15,
        team_a_id=t1.id,
        team_b_id=t2.id,
        team_a_score=Decimal("110.00"),
        team_b_score=Decimal("99.50"),
        winner_team_id=t1.id,
        is_finalized=True,
    )
    db_session.add(matchup)
    db_session.commit()

    loaded = db_session.query(Bracket).filter_by(season_id=season.id).one()
    assert loaded.size == 8
    seeds = db_session.query(BracketSeed).filter_by(bracket_id=loaded.id).all()
    assert {s.seed for s in seeds} == {1, 8}
    m = db_session.query(BracketMatchup).filter_by(bracket_id=loaded.id).one()
    assert m.winner_team_id == t1.id
    assert m.is_finalized is True
    assert m.bye is False
