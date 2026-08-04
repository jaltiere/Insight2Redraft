from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction


@dataclass(frozen=True)
class TeamStanding:
    team_id: int
    league_id: int
    wins: int
    losses: int
    ties: int
    points_for: Decimal


@dataclass(frozen=True)
class SeededTeam:
    team_id: int
    seed: int  # 1..K, 1 = best


@dataclass(frozen=True)
class RemainingTeam:
    team_id: int
    seed: int  # original seed, carried every round


@dataclass(frozen=True)
class RoundGame:
    high: int  # team_id of the better (lower-numbered) original seed
    low: int  # team_id of the worse original seed


@dataclass(frozen=True)
class RoundPlan:
    games: list[RoundGame]
    byes: list[int]  # team_ids of top seeds receiving a bye


@dataclass(frozen=True)
class MatchupSide:
    team_id: int
    seed: int
    starter_points: Decimal
    bench_points: Decimal


def resolve_matchup(a: MatchupSide, b: MatchupSide) -> int:
    """Return the winning team_id: higher starter points, then higher bench
    points, then better (lower-numbered) original seed. Seeds are unique within
    a bracket, so the seed fallback always decides."""
    if a.starter_points != b.starter_points:
        return a.team_id if a.starter_points > b.starter_points else b.team_id
    if a.bench_points != b.bench_points:
        return a.team_id if a.bench_points > b.bench_points else b.team_id
    return a.team_id if a.seed < b.seed else b.team_id


def _rank_key(s: TeamStanding) -> tuple[Fraction, Decimal, int]:
    games = s.wins + s.losses + s.ties
    win_pct = Fraction(s.wins * 2 + s.ties, games * 2) if games else Fraction(0)
    # Better teams sort first: higher win%, then higher points_for, then lower team_id.
    return (-win_pct, -s.points_for, s.team_id)


def seed_field(
    standings: Iterable[TeamStanding], field_per_league: int
) -> list[SeededTeam]:
    """Take the top ``field_per_league`` teams per league, pool them, and assign
    global seeds 1..K ordered by (win%, points_for, team_id). A league with fewer
    than ``field_per_league`` teams contributes all of them."""
    by_league: dict[int, list[TeamStanding]] = {}
    for standing in standings:
        by_league.setdefault(standing.league_id, []).append(standing)

    qualifiers: list[TeamStanding] = []
    for teams in by_league.values():
        qualifiers.extend(sorted(teams, key=_rank_key)[:field_per_league])

    qualifiers.sort(key=_rank_key)
    return [SeededTeam(team_id=s.team_id, seed=i + 1) for i, s in enumerate(qualifiers)]


def _is_power_of_two(n: int) -> bool:
    return n & (n - 1) == 0  # valid for n >= 1


def _largest_power_of_two_below(n: int) -> int:
    """Largest power of two strictly less than n (n >= 2)."""
    p = 1
    while p * 2 < n:
        p *= 2
    return p


def generate_round(remaining: Iterable[RemainingTeam]) -> RoundPlan:
    """Reseed the survivors by original seed and pair high-vs-low, giving byes to
    the top seeds when the field isn't a power of two (reducing it to the largest
    power of two below N). Requires at least 2 teams; the caller treats a single
    remaining team as the champion."""
    ordered = sorted(remaining, key=lambda t: t.seed)
    n = len(ordered)
    if n < 2:
        raise ValueError("generate_round requires at least 2 remaining teams")

    if _is_power_of_two(n):
        byes: list[int] = []
        playing = ordered
    else:
        p = _largest_power_of_two_below(n)
        b = 2 * p - n
        byes = [t.team_id for t in ordered[:b]]
        playing = ordered[b:]

    m = len(playing)
    games = [
        RoundGame(high=playing[i].team_id, low=playing[m - 1 - i].team_id)
        for i in range(m // 2)
    ]
    return RoundPlan(games=games, byes=byes)
