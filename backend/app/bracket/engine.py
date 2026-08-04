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
