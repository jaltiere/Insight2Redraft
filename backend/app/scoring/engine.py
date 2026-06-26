from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal

_CENTS = Decimal("0.01")


def score_stat_line(stats: Mapping[str, float], ruleset: Mapping[str, float]) -> Decimal:
    """Score one player's stat line.

    Sums ``stat_value * multiplier`` over the keys present in BOTH ``stats`` and
    ``ruleset`` (keys in only one map contribute nothing), then rounds the total
    to 2 decimals using ROUND_HALF_UP. This mirrors how Sleeper scores: a
    per-unit multiplier times the stat value, summed.
    """
    total = Decimal("0")
    for key in stats.keys() & ruleset.keys():
        total += Decimal(str(stats[key])) * Decimal(str(ruleset[key]))
    return total.quantize(_CENTS, rounding=ROUND_HALF_UP)
