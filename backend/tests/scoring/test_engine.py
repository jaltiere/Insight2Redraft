from decimal import Decimal

from app.scoring.engine import score_players, score_stat_line, sum_points
from app.scoring.rulesets import DEFAULT_PPR


def test_score_ppr_wr_line():
    # 6 rec*1 + 88 rec_yd*0.1 + 1 rec_td*6 = 6 + 8.8 + 6 = 20.80
    stats = {"rec": 6, "rec_yd": 88, "rec_td": 1}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("20.80")


def test_score_qb_line_with_negatives():
    # 305*0.04 + 2*4 + 1*-2 + 18*0.1 = 12.2 + 8 - 2 + 1.8 = 20.00
    stats = {"pass_yd": 305, "pass_td": 2, "pass_int": 1, "rush_yd": 18}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("20.00")


def test_empty_stats_is_zero():
    assert score_stat_line({}, DEFAULT_PPR) == Decimal("0.00")


def test_disjoint_keys_contribute_nothing():
    # 'snaps' not in ruleset; 'rush_td' in ruleset but not in stats. Only rec counts.
    stats = {"snaps": 50, "rec": 4}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("4.00")


def test_rounding_is_half_up():
    # 4.25 * 0.5 = 2.125 -> quantize to 0.01 half-up -> 2.13
    assert score_stat_line({"x": 4.25}, {"x": 0.5}) == Decimal("2.13")


def test_score_players_maps_each_player():
    player_stats = {"a": {"rec": 5}, "b": {"rush_yd": 100, "rush_td": 1}}
    result = score_players(player_stats, DEFAULT_PPR)
    assert result == {"a": Decimal("5.00"), "b": Decimal("16.00")}


def test_sum_points_starter_subset():
    points = {"a": Decimal("5.00"), "b": Decimal("16.00"), "c": Decimal("9.50")}
    assert sum_points(["a", "c"], points) == Decimal("14.50")


def test_sum_points_missing_player_contributes_zero():
    assert sum_points(["a", "z"], {"a": Decimal("5.00")}) == Decimal("5.00")


def test_sum_points_empty_is_zero():
    assert sum_points([], {}) == Decimal("0")


def test_score_negative_only_line():
    # 2 interceptions * -2 = -4.00 (ROUND_HALF_UP rounds away from zero on negatives, correct here)
    assert score_stat_line({"pass_int": 2}, DEFAULT_PPR) == Decimal("-4.00")
