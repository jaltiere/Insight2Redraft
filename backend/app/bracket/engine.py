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
