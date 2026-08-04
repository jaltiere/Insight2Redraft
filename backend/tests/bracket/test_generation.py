from decimal import Decimal

import pytest

from app.bracket.generation import BracketGenerationError, generate_bracket
from app.models import BracketMatchup, BracketSeed, BracketStatus, QualifiedVia, SeasonStatus


def _season_4(seed):
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


def test_generate_bracket_pending_bracket_and_seeds(db_session, seed):
    season = _season_4(seed)
    bracket = generate_bracket(db_session, season)
    db_session.flush()
    assert bracket.status is BracketStatus.PENDING
    assert bracket.size == 4
    seeds = (
        db_session.query(BracketSeed)
        .filter_by(bracket_id=bracket.id).order_by(BracketSeed.seed).all()
    )
    assert [s.seed for s in seeds] == [1, 2, 3, 4]
    assert all(s.qualified_via is QualifiedVia.AUTO for s in seeds)


def test_generate_bracket_round_one_high_vs_low(db_session, seed):
    season = _season_4(seed)
    bracket = generate_bracket(db_session, season)
    seed_by_team = {
        s.team_id: s.seed
        for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)
    }
    games = (
        db_session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id, bye=False).all()
    )
    assert len(games) == 2
    pairs = {(seed_by_team[m.team_a_id], seed_by_team[m.team_b_id]) for m in games}
    assert pairs == {(1, 4), (2, 3)}  # team_a is the better seed
    assert all(m.round == 1 and m.nfl_week == 15 and not m.is_finalized for m in games)


def test_generate_bracket_byes_are_auto_advanced_matchups(db_session, seed):
    # 6 qualifiers (field=3, two leagues) -> byes to the top two seeds
    season = seed.season(
        2025, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=3, nfl_playoff_weeks=[15, 16, 17],
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    for w, pf in [(12, "1600"), (10, "1500"), (8, "1400")]:
        seed.team(la, wins=w, losses=13 - w, points_for=Decimal(pf))
    for w, pf in [(11, "1550"), (9, "1450"), (7, "1350")]:
        seed.team(lb, wins=w, losses=13 - w, points_for=Decimal(pf))

    bracket = generate_bracket(db_session, season)
    byes = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, bye=True).all()
    games = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, bye=False).all()
    assert len(byes) == 2 and len(games) == 2  # 6 -> 2 byes + 2 games -> field of 4
    for b in byes:
        assert b.team_b_id is None
        assert b.winner_team_id == b.team_a_id
        assert b.is_finalized is True


def test_generate_bracket_too_few_teams_raises(db_session, seed):
    season = seed.season(
        2026, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=5, losses=8, points_for=Decimal("1000"))  # one team total
    with pytest.raises(BracketGenerationError):
        generate_bracket(db_session, season)


def test_generate_bracket_no_playoff_weeks_raises(db_session, seed):
    season = seed.season(
        2027, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[],
    )
    la = seed.league(season, name="A")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))
    with pytest.raises(BracketGenerationError):
        generate_bracket(db_session, season)
