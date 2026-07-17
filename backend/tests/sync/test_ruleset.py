from app.models import ScoringRuleset, Season
from app.scoring.rulesets import DEFAULT_PPR
from app.sync.ruleset import resolve_ruleset


def test_resolve_ruleset_returns_row_rules_when_set(db_session):
    rs = ScoringRuleset(name="custom", rules={"rec": 0.5})
    db_session.add(rs)
    db_session.flush()
    season = Season(year=2031, scoring_ruleset_id=rs.id)
    db_session.add(season)
    db_session.flush()

    assert resolve_ruleset(db_session, season) == {"rec": 0.5}


def test_resolve_ruleset_falls_back_to_default_ppr_when_unset(db_session):
    season = Season(year=2032)
    db_session.add(season)
    db_session.flush()

    assert resolve_ruleset(db_session, season) is DEFAULT_PPR
