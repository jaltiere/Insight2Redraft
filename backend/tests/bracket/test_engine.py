from decimal import Decimal

from app.bracket.engine import MatchupSide, resolve_matchup


def _side(team_id, seed, starter, bench):
    return MatchupSide(
        team_id=team_id,
        seed=seed,
        starter_points=Decimal(str(starter)),
        bench_points=Decimal(str(bench)),
    )


def test_resolve_higher_starter_points_wins():
    a = _side(1, 1, "120.5", "40")
    b = _side(2, 8, "118.0", "90")
    assert resolve_matchup(a, b) == 1
    assert resolve_matchup(b, a) == 1  # order-independent


def test_resolve_bench_breaks_starter_tie():
    a = _side(1, 3, "100.0", "30.0")
    b = _side(2, 4, "100.0", "45.0")
    assert resolve_matchup(a, b) == 2
    assert resolve_matchup(b, a) == 2


def test_resolve_seed_breaks_full_tie():
    a = _side(1, 2, "100.0", "50.0")
    b = _side(2, 5, "100.0", "50.0")
    assert resolve_matchup(a, b) == 1  # seed 2 is better than seed 5
    assert resolve_matchup(b, a) == 1
