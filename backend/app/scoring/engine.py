from collections.abc import Iterable, Mapping
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


def score_players(
    player_stats: Mapping[str, Mapping[str, float]],
    ruleset: Mapping[str, float],
) -> dict[str, Decimal]:
    """Score many players at once: player_id -> points."""
    return {pid: score_stat_line(line, ruleset) for pid, line in player_stats.items()}


def sum_points(
    player_ids: Iterable[str],
    player_points: Mapping[str, Decimal],
) -> Decimal:
    """Sum the points of a subset of already-scored players.

    Used by the sync service to total a lineup (e.g. starters) or a bench from
    already-computed per-player points. Player ids absent from ``player_points``
    contribute ``Decimal("0")``.
    """
    total = Decimal("0")
    for pid in player_ids:
        total += player_points.get(pid, Decimal("0"))
    return total
