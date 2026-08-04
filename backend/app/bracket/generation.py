from sqlalchemy.orm import Session

from app.bracket.engine import RemainingTeam, TeamStanding, generate_round, seed_field
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    League,
    QualifiedVia,
    Season,
    Team,
)


class BracketGenerationError(Exception):
    """A season cannot form a bracket (too few teams / no playoff weeks)."""


def generate_bracket(session: Session, season: Season) -> Bracket:
    """Seed the pooled field from final standings and create a PENDING bracket
    with its seeds and round-1 matchups (games high-vs-low; byes auto-advanced).
    Flushes but does not commit — the caller owns the transaction."""
    teams = (
        session.query(Team)
        .join(League, Team.league_id == League.id)
        .filter(League.season_id == season.id)
        .all()
    )
    standings = [
        TeamStanding(
            team_id=t.id,
            league_id=t.league_id,
            wins=t.wins,
            losses=t.losses,
            ties=t.ties,
            points_for=t.points_for,
        )
        for t in teams
    ]
    seeds = seed_field(standings, season.playoff_field_per_league)
    if len(seeds) < 2:
        raise BracketGenerationError("not enough teams to form a bracket")
    if not season.nfl_playoff_weeks:
        raise BracketGenerationError("season has no playoff weeks configured")

    bracket = Bracket(
        season_id=season.id, size=len(seeds), status=BracketStatus.PENDING
    )
    session.add(bracket)
    session.flush()

    for st in seeds:
        session.add(
            BracketSeed(
                bracket_id=bracket.id,
                team_id=st.team_id,
                seed=st.seed,
                qualified_via=QualifiedVia.AUTO,
            )
        )

    week = season.nfl_playoff_weeks[0]
    plan = generate_round([RemainingTeam(team_id=st.team_id, seed=st.seed) for st in seeds])
    for game in plan.games:
        session.add(
            BracketMatchup(
                bracket_id=bracket.id,
                round=1,
                nfl_week=week,
                team_a_id=game.high,
                team_b_id=game.low,
                bye=False,
                is_finalized=False,
            )
        )
    for bye_team_id in plan.byes:
        session.add(
            BracketMatchup(
                bracket_id=bracket.id,
                round=1,
                nfl_week=week,
                team_a_id=bye_team_id,
                team_b_id=None,
                bye=True,
                winner_team_id=bye_team_id,
                is_finalized=True,
            )
        )
    session.flush()
    return bracket
