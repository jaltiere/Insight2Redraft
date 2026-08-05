from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import (
    BracketMatchupPublic,
    BracketPublic,
    BracketRoundPublic,
    BracketTeamRef,
    OwnerRef,
)
from app.db import get_db
from app.models import Bracket, BracketMatchup, BracketSeed, BracketStatus, Owner, Team

router = APIRouter(tags=["public"])

_PUBLIC_STATUSES = {BracketStatus.ACTIVE, BracketStatus.COMPLETE}


@router.get("/seasons/{season_id}/bracket", response_model=BracketPublic)
def get_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketPublic:
    bracket = db.execute(
        select(Bracket).where(Bracket.season_id == season_id)
    ).scalar_one_or_none()
    if bracket is None or bracket.status not in _PUBLIC_STATUSES:
        raise HTTPException(status_code=404, detail="Bracket not found")

    seed_rows = db.execute(
        select(BracketSeed)
        .where(BracketSeed.bracket_id == bracket.id)
        .order_by(BracketSeed.seed)
    ).scalars().all()
    seed_by_team = {s.team_id: s.seed for s in seed_rows}

    def team_ref(team_id: int | None) -> BracketTeamRef | None:
        if team_id is None:
            return None
        team = db.get(Team, team_id)
        owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
        return BracketTeamRef(
            team_id=team.id,
            seed=seed_by_team.get(team.id, 0),
            league_name=team.league.name,
            owner=OwnerRef.model_validate(owner) if owner is not None else None,
        )

    def score(value) -> float | None:
        return float(value) if value is not None else None

    matchups = db.execute(
        select(BracketMatchup)
        .where(BracketMatchup.bracket_id == bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
    ).scalars().all()

    by_round: dict[int, list[BracketMatchup]] = {}
    for m in matchups:
        by_round.setdefault(m.round, []).append(m)

    rounds = [
        BracketRoundPublic(
            round=rnd,
            nfl_week=group[0].nfl_week,
            matchups=[
                BracketMatchupPublic(
                    round=m.round,
                    nfl_week=m.nfl_week,
                    bye=m.bye,
                    is_finalized=m.is_finalized,
                    team_a=team_ref(m.team_a_id),
                    team_b=team_ref(m.team_b_id),
                    team_a_score=score(m.team_a_score),
                    team_b_score=score(m.team_b_score),
                    winner_team_id=m.winner_team_id,
                )
                for m in group
            ],
        )
        for rnd, group in sorted(by_round.items())
    ]

    return BracketPublic(
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=[team_ref(s.team_id) for s in seed_rows],
        rounds=rounds,
    )
