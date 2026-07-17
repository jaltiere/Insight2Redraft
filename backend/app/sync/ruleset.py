from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.models import ScoringRuleset, Season
from app.scoring.rulesets import DEFAULT_PPR


def resolve_ruleset(session: Session, season: Season) -> Mapping[str, float]:
    """The season's configured ruleset rows, or DEFAULT_PPR when unset/missing."""
    if season.scoring_ruleset_id is not None:
        row = session.get(ScoringRuleset, season.scoring_ruleset_id)
        if row is not None:
            return row.rules
    return DEFAULT_PPR
