from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationResult:
    validated: bool
    diffs: list[tuple[str, float, float]]


def validate_scoring(
    league_scoring: Mapping[str, float],
    platform_ruleset: Mapping[str, float],
) -> ValidationResult:
    """Compare a league's Sleeper scoring settings to the platform ruleset.

    A category absent from either side is treated as 0.0. ``validated`` is True
    only when every category matches exactly. ``diffs`` lists every mismatching
    category as ``(category, league_value, platform_value)``, sorted by name.
    """
    diffs: list[tuple[str, float, float]] = []
    for key in sorted(set(league_scoring) | set(platform_ruleset)):
        league_value = league_scoring.get(key, 0.0)
        platform_value = platform_ruleset.get(key, 0.0)
        if league_value != platform_value:
            diffs.append((key, league_value, platform_value))
    return ValidationResult(validated=not diffs, diffs=diffs)
