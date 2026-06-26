from decimal import Decimal

from app.scoring.engine import score_stat_line
from app.scoring.rulesets import DEFAULT_PPR


def test_default_ppr_is_flat_float_map():
    assert isinstance(DEFAULT_PPR, dict)
    assert all(isinstance(k, str) for k in DEFAULT_PPR)
    assert all(isinstance(v, float) for v in DEFAULT_PPR.values())


def test_default_ppr_has_core_offensive_keys():
    for key in ("pass_yd", "pass_td", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost"):
        assert key in DEFAULT_PPR


def test_default_ppr_is_full_ppr():
    assert DEFAULT_PPR["rec"] == 1.0


def test_default_ppr_scores_a_line():
    # 5 rec*1 + 50 rec_yd*0.1 + 1 rec_td*6 = 5 + 5 + 6 = 16.00
    stats = {"rec": 5, "rec_yd": 50, "rec_td": 1}
    assert score_stat_line(stats, DEFAULT_PPR) == Decimal("16.00")
