from app.sync.validation import ValidationResult, validate_scoring


def test_exact_match_is_validated():
    ruleset = {"rec": 1.0, "pass_td": 4.0}
    result = validate_scoring({"rec": 1.0, "pass_td": 4.0}, ruleset)
    assert isinstance(result, ValidationResult)
    assert result.validated is True
    assert result.diffs == []


def test_single_category_diff_is_not_validated():
    result = validate_scoring({"rec": 0.5, "pass_td": 4.0}, {"rec": 1.0, "pass_td": 4.0})
    assert result.validated is False
    assert result.diffs == [("rec", 0.5, 1.0)]


def test_absent_category_normalizes_to_zero():
    # league omits pass_td entirely; platform scores it -> diff against 0.0
    result = validate_scoring({"rec": 1.0}, {"rec": 1.0, "pass_td": 4.0})
    assert result.validated is False
    assert result.diffs == [("pass_td", 0.0, 4.0)]


def test_absent_on_both_effective_sides_is_validated():
    # platform has rec only; league has rec plus a category that is 0.0 -> no effect
    result = validate_scoring({"rec": 1.0, "bonus": 0.0}, {"rec": 1.0})
    assert result.validated is True
    assert result.diffs == []


def test_extra_nonzero_league_category_is_not_validated():
    result = validate_scoring({"rec": 1.0, "bonus": 2.0}, {"rec": 1.0})
    assert result.validated is False
    assert result.diffs == [("bonus", 2.0, 0.0)]
