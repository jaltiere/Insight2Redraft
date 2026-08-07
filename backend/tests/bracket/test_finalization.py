from decimal import Decimal

import pytest

from app.bracket.finalization import (
    NothingToFinalize,
    NotEnoughPlayoffWeeks,
    ScoresNotSynced,
    finalize_current_round,
    update_bracket_live_scores,
)
from app.bracket.generation import generate_bracket
from app.models import BracketMatchup, BracketSeed, BracketStatus, SeasonStatus, WeeklyScore


def _active_bracket_4(db_session, seed, *, year=2024, weeks=(15, 16, 17)):
    season = seed.season(
        year, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=list(weeks),
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    seed.team(la, wins=10, losses=3, points_for=Decimal("1500"))  # seed 1
    seed.team(la, wins=8, losses=5, points_for=Decimal("1400"))   # seed 3
    seed.team(lb, wins=9, losses=4, points_for=Decimal("1450"))   # seed 2
    seed.team(lb, wins=7, losses=6, points_for=Decimal("1390"))   # seed 4
    bracket = generate_bracket(db_session, season)
    bracket.status = BracketStatus.ACTIVE
    db_session.flush()
    return season, bracket


def _active_bracket_6(db_session, seed, *, year=2030, weeks=(15, 16, 17)):
    season = seed.season(
        year, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=3, nfl_playoff_weeks=list(weeks),
    )
    la = seed.league(season, name="A")
    lb = seed.league(season, name="B")
    for w, pf in [(12, "1600"), (10, "1500"), (8, "1400")]:
        seed.team(la, wins=w, losses=13 - w, points_for=Decimal(pf))
    for w, pf in [(11, "1550"), (9, "1450"), (7, "1350")]:
        seed.team(lb, wins=w, losses=13 - w, points_for=Decimal(pf))
    bracket = generate_bracket(db_session, season)
    bracket.status = BracketStatus.ACTIVE
    db_session.flush()
    return season, bracket


def _seed_map(db_session, bracket):
    return {s.seed: s.team_id for s in db_session.query(BracketSeed).filter_by(bracket_id=bracket.id)}


def _weekly(db_session, team_id, week, recomputed, bench="0"):
    db_session.add(
        WeeklyScore(
            team_id=team_id, week=week,
            sleeper_points=Decimal(recomputed),
            recomputed_points=Decimal(recomputed),
            bench_points=Decimal(bench),
        )
    )
    db_session.flush()


def test_finalize_round_one_advances(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)

    finalize_current_round(db_session, bracket)

    r1 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=1, bye=False).all()
    assert all(g.is_finalized and g.winner_team_id is not None for g in r1)
    assert {g.winner_team_id for g in r1} == {m[1], m[2]}
    assert db_session.query(WeeklyScore).filter_by(team_id=m[1], week=15).one().is_final is True
    r2 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2).all()
    assert len(r2) == 1 and r2[0].nfl_week == 16 and not r2[0].is_finalized
    assert bracket.status is BracketStatus.ACTIVE


def test_finalize_round_one_advances_byes(db_session, seed):
    # 6 teams -> round 1: byes to seeds 1,2; games seed3v6, seed4v5 at week 15
    season, bracket = _active_bracket_6(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(3, "100"), (6, "90"), (4, "100"), (5, "80")]:
        _weekly(db_session, m[s], 15, pts)  # seeds 3 and 4 win their games

    finalize_current_round(db_session, bracket)

    r2 = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2).all()
    r2_team_ids = {tid for g in r2 for tid in (g.team_a_id, g.team_b_id)}
    assert r2_team_ids == {m[1], m[2], m[3], m[4]}  # byes 1,2 + winners 3,4 advance
    assert bracket.status is BracketStatus.ACTIVE


def test_finalize_bench_breaks_starter_tie(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    # seed1 vs seed4: equal starters, seed4 higher bench -> seed4 upsets
    _weekly(db_session, m[1], 15, "100", bench="10")
    _weekly(db_session, m[4], 15, "100", bench="50")
    _weekly(db_session, m[2], 15, "110")
    _weekly(db_session, m[3], 15, "90")

    finalize_current_round(db_session, bracket)

    game = db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, team_a_id=m[1]
    ).one()
    assert game.winner_team_id == m[4]


def test_finalize_final_round_completes(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)  # -> round 2 (seeds 1,2)
    _weekly(db_session, m[1], 16, "130")
    _weekly(db_session, m[2], 16, "120")

    finalize_current_round(db_session, bracket)

    assert bracket.status is BracketStatus.COMPLETE
    assert db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=3).count() == 0
    final = db_session.query(BracketMatchup).filter_by(bracket_id=bracket.id, round=2, bye=False).one()
    assert final.winner_team_id == m[1]


def test_finalize_scores_not_synced_raises(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    with pytest.raises(ScoresNotSynced):
        finalize_current_round(db_session, bracket)


def test_finalize_not_enough_playoff_weeks_raises_before_mutation(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed, year=2028, weeks=(15,))  # only one week
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)

    with pytest.raises(NotEnoughPlayoffWeeks):
        finalize_current_round(db_session, bracket)

    # all-or-nothing: no round-1 game was finalized
    assert db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, bye=False, is_finalized=True
    ).count() == 0


def test_finalize_nothing_to_finalize_when_complete(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)
    _weekly(db_session, m[1], 16, "130")
    _weekly(db_session, m[2], 16, "120")
    finalize_current_round(db_session, bracket)  # -> COMPLETE

    with pytest.raises(NothingToFinalize):
        finalize_current_round(db_session, bracket)


def test_update_live_scores_copies_recomputed(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "55.5"), (4, "48.0"), (2, "60"), (3, "40")]:
        _weekly(db_session, m[s], 15, pts)

    updated = update_bracket_live_scores(db_session, season.id, 15)

    assert updated == 2
    game = db_session.query(BracketMatchup).filter_by(
        bracket_id=bracket.id, round=1, team_a_id=m[1]
    ).one()
    assert str(game.team_a_score) == "55.50"
    assert game.winner_team_id is None and not game.is_finalized


def test_update_live_scores_skips_finalized(db_session, seed):
    season, bracket = _active_bracket_4(db_session, seed)
    m = _seed_map(db_session, bracket)
    for s, pts in [(1, "120"), (4, "100"), (2, "110"), (3, "90")]:
        _weekly(db_session, m[s], 15, pts)
    finalize_current_round(db_session, bracket)  # round 1 finalized

    assert update_bracket_live_scores(db_session, season.id, 15) == 0


def test_update_live_scores_noop_without_active_bracket(db_session, seed):
    season = seed.season(
        2029, status=SeasonStatus.PLAYOFFS,
        playoff_field_per_league=2, nfl_playoff_weeks=[15, 16],
    )
    assert update_bracket_live_scores(db_session, season.id, 15) == 0
