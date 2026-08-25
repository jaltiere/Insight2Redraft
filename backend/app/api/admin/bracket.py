from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    BracketAdminResponse,
    BracketMatchupAdmin,
    BracketSeedAdmin,
)
from app.api.deps import require_super_admin
from app.api.public_schemas import BracketTeamRef, OwnerRef
from app.bracket.finalization import (
    NothingToFinalize,
    NotEnoughPlayoffWeeks,
    ScoresNotSynced,
    finalize_current_round,
)
from app.bracket.generation import BracketGenerationError, generate_bracket
from app.db import get_db
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    Owner,
    Season,
    SeasonStatus,
    Team,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _get_bracket(db: Session, season_id: int) -> Bracket | None:
    return db.execute(
        select(Bracket).where(Bracket.season_id == season_id)
    ).scalar_one_or_none()


def _bracket_response(db: Session, bracket: Bracket) -> BracketAdminResponse:
    seeds = db.execute(
        select(BracketSeed)
        .where(BracketSeed.bracket_id == bracket.id)
        .order_by(BracketSeed.seed)
    ).scalars().all()
    seed_by_team = {s.team_id: s.seed for s in seeds}

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

    seed_admins = []
    for s in seeds:
        team = db.get(Team, s.team_id)
        owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
        seed_admins.append(
            BracketSeedAdmin(
                seed=s.seed,
                team_id=s.team_id,
                qualified_via=s.qualified_via,
                league_name=team.league.name,
                owner=OwnerRef.model_validate(owner) if owner is not None else None,
            )
        )

    return BracketAdminResponse(
        id=bracket.id,
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=seed_admins,
        matchups=[
            BracketMatchupAdmin(
                id=m.id,
                round=m.round,
                nfl_week=m.nfl_week,
                team_a=team_ref(m.team_a_id),
                team_b=team_ref(m.team_b_id),
                team_a_score=score(m.team_a_score),
                team_b_score=score(m.team_b_score),
                winner_team_id=m.winner_team_id,
                is_finalized=m.is_finalized,
                bye=m.bye,
            )
            for m in matchups
        ],
    )


@router.post(
    "/seasons/{season_id}/bracket",
    response_model=BracketAdminResponse,
    status_code=201,
)
def generate_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    if season.status is not SeasonStatus.PLAYOFFS:
        raise HTTPException(status_code=409, detail="Season is not in playoffs")
    existing = _get_bracket(db, season_id)
    if existing is not None:
        if existing.status is not BracketStatus.PENDING:
            raise HTTPException(status_code=409, detail="Bracket already approved")
        db.delete(existing)
        db.flush()
    try:
        bracket = generate_bracket(db, season)
    except BracketGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _bracket_response(db, bracket)


@router.post(
    "/seasons/{season_id}/bracket/approve", response_model=BracketAdminResponse
)
def approve_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    if bracket.status is not BracketStatus.PENDING:
        raise HTTPException(status_code=409, detail="Bracket is not pending")
    bracket.status = BracketStatus.ACTIVE
    db.commit()
    return _bracket_response(db, bracket)


@router.get("/seasons/{season_id}/bracket", response_model=BracketAdminResponse)
def read_season_bracket(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    return _bracket_response(db, bracket)


@router.post(
    "/seasons/{season_id}/bracket/finalize-round",
    response_model=BracketAdminResponse,
)
def finalize_season_bracket_round(
    season_id: int, db: Session = Depends(get_db)
) -> BracketAdminResponse:
    bracket = _get_bracket(db, season_id)
    if bracket is None:
        raise HTTPException(status_code=404, detail="Bracket not found")
    if bracket.status is not BracketStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Bracket is not active")
    try:
        finalize_current_round(db, bracket)
    except (ScoresNotSynced, NothingToFinalize) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotEnoughPlayoffWeeks as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _bracket_response(db, bracket)
