from decimal import Decimal

from sqlalchemy.orm import Session

from app.bracket.engine import (
    MatchupSide,
    RemainingTeam,
    generate_round,
    resolve_matchup,
)
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    Season,
    WeeklyScore,
)


class FinalizeError(Exception):
    """Base for round-finalization failures."""


class ScoresNotSynced(FinalizeError):
    """A game team has no synced recomputed score for the round's week."""


class NothingToFinalize(FinalizeError):
    """No unfinalized round remains."""


class NotEnoughPlayoffWeeks(FinalizeError):
    """The season has no configured NFL week for the next round."""


def finalize_current_round(session: Session, bracket: Bracket) -> Bracket:
    """Decide the current round from already-synced WeeklyScore data, lock those
    scores, and advance the bracket (next round via the engine, or COMPLETE).
    All guards are checked before any mutation. Flushes but does not commit."""
    matchups = (
        session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
        .all()
    )
    unfinalized_rounds = [m.round for m in matchups if not m.is_finalized]
    if not unfinalized_rounds:
        raise NothingToFinalize("no round to finalize")
    current_round = min(unfinalized_rounds)
    round_matchups = [m for m in matchups if m.round == current_round]
    games = [m for m in round_matchups if not m.bye]
    week = round_matchups[0].nfl_week
    seed_by_team = {
        s.team_id: s.seed
        for s in session.query(BracketSeed).filter_by(bracket_id=bracket.id)
    }

    game_team_ids = [tid for g in games for tid in (g.team_a_id, g.team_b_id)]
    ws_by_team = {
        ws.team_id: ws
        for ws in session.query(WeeklyScore).filter(
            WeeklyScore.team_id.in_(game_team_ids), WeeklyScore.week == week
        )
    }
    for tid in game_team_ids:
        ws = ws_by_team.get(tid)
        if ws is None or ws.recomputed_points is None:
            raise ScoresNotSynced(f"scores not synced for week {week}")

    season = session.get(Season, bracket.season_id)
    survivor_count = len(round_matchups)
    if survivor_count > 1 and len(season.nfl_playoff_weeks) <= current_round:
        raise NotEnoughPlayoffWeeks(f"no playoff week for round {current_round + 1}")

    for g in games:
        a = ws_by_team[g.team_a_id]
        b = ws_by_team[g.team_b_id]
        winner = resolve_matchup(
            MatchupSide(
                team_id=g.team_a_id,
                seed=seed_by_team[g.team_a_id],
                starter_points=a.recomputed_points,
                bench_points=a.bench_points or Decimal("0"),
            ),
            MatchupSide(
                team_id=g.team_b_id,
                seed=seed_by_team[g.team_b_id],
                starter_points=b.recomputed_points,
                bench_points=b.bench_points or Decimal("0"),
            ),
        )
        g.team_a_score = a.recomputed_points
        g.team_b_score = b.recomputed_points
        g.winner_team_id = winner
        g.is_finalized = True
        a.is_final = True
        b.is_final = True

    survivors = [
        RemainingTeam(team_id=m.winner_team_id, seed=seed_by_team[m.winner_team_id])
        for m in round_matchups
    ]
    if len(survivors) == 1:
        bracket.status = BracketStatus.COMPLETE
    else:
        next_round = current_round + 1
        next_week = season.nfl_playoff_weeks[current_round]  # 0-indexed: round n -> index n-1
        plan = generate_round(survivors)
        for game in plan.games:
            session.add(
                BracketMatchup(
                    bracket_id=bracket.id,
                    round=next_round,
                    nfl_week=next_week,
                    team_a_id=game.high,
                    team_b_id=game.low,
                    bye=False,
                    is_finalized=False,
                )
            )
        for bye_tid in plan.byes:
            session.add(
                BracketMatchup(
                    bracket_id=bracket.id,
                    round=next_round,
                    nfl_week=next_week,
                    team_a_id=bye_tid,
                    team_b_id=None,
                    bye=True,
                    winner_team_id=bye_tid,
                    is_finalized=True,
                )
            )
    session.flush()
    return bracket


def update_bracket_live_scores(session: Session, season_id: int, week: int) -> int:
    """Copy recomputed_points into the ACTIVE bracket's current-week, unfinalized,
    non-bye matchups. Never sets winner/is_finalized. Returns the number of
    matchups touched. Idempotent no-op when there is no ACTIVE bracket."""
    bracket = (
        session.query(Bracket)
        .filter_by(season_id=season_id, status=BracketStatus.ACTIVE)
        .one_or_none()
    )
    if bracket is None:
        return 0
    matchups = (
        session.query(BracketMatchup)
        .filter_by(bracket_id=bracket.id, nfl_week=week, is_finalized=False, bye=False)
        .all()
    )
    if not matchups:
        return 0
    team_ids = [tid for m in matchups for tid in (m.team_a_id, m.team_b_id) if tid is not None]
    recomputed = {
        ws.team_id: ws.recomputed_points
        for ws in session.query(WeeklyScore).filter(
            WeeklyScore.team_id.in_(team_ids), WeeklyScore.week == week
        )
        if ws.recomputed_points is not None
    }
    updated = 0
    for m in matchups:
        touched = False
        if m.team_a_id in recomputed:
            m.team_a_score = recomputed[m.team_a_id]
            touched = True
        if m.team_b_id in recomputed:
            m.team_b_score = recomputed[m.team_b_id]
            touched = True
        if touched:
            updated += 1
    session.flush()
    return updated
