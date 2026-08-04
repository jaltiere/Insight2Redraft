from decimal import Decimal

from app.bracket.engine import MatchupSide, TeamStanding, resolve_matchup, seed_field


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


def _st(team_id, league_id, w, l, t=0, pf="0"):
    return TeamStanding(
        team_id=team_id, league_id=league_id, wins=w, losses=l, ties=t,
        points_for=Decimal(pf),
    )


def _seeds(result):
    return [(s.team_id, s.seed) for s in result]


def test_seed_field_top_n_per_league_and_pooled_order():
    standings = [
        _st(1, 10, 10, 3, pf="1500"),
        _st(2, 10, 8, 5, pf="1400"),
        _st(3, 10, 4, 9, pf="1200"),  # cut (N=2)
        _st(4, 20, 9, 4, pf="1450"),
        _st(5, 20, 7, 6, pf="1390"),
        _st(6, 20, 2, 11, pf="1100"),  # cut
    ]
    result = seed_field(standings, field_per_league=2)
    # win%: 1=.769, 4=.692, 2=.615, 5=.538
    assert _seeds(result) == [(1, 1), (4, 2), (2, 3), (5, 4)]


def test_seed_field_points_for_breaks_equal_record():
    standings = [
        _st(1, 10, 9, 4, pf="1400"),
        _st(2, 20, 9, 4, pf="1500"),  # same record, more PF -> seed 1
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(2, 1), (1, 2)]


def test_seed_field_team_id_breaks_full_tie():
    standings = [
        _st(7, 10, 9, 4, pf="1400"),
        _st(3, 20, 9, 4, pf="1400"),  # identical record + PF -> lower team_id first
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(3, 1), (7, 2)]


def test_seed_field_ties_count_as_half():
    # A 8-4-1 -> 17/26 = .654 ; B 8-5-0 -> 16/26 = .615 ; A ranks higher despite lower PF
    standings = [
        _st(1, 10, 8, 4, t=1, pf="1000"),
        _st(2, 20, 8, 5, t=0, pf="9999"),
    ]
    assert _seeds(seed_field(standings, field_per_league=1)) == [(1, 1), (2, 2)]


def test_seed_field_league_with_fewer_than_n_contributes_all():
    standings = [
        _st(1, 10, 10, 3, pf="1500"),
        _st(2, 10, 5, 8, pf="1200"),
        _st(3, 20, 9, 4, pf="1450"),  # league 20 has one team
    ]
    result = seed_field(standings, field_per_league=2)
    assert {s.team_id for s in result} == {1, 2, 3}
    assert [s.seed for s in result] == [1, 2, 3]  # contiguous 1..K
