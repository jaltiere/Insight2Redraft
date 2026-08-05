from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    BracketAdminResponse,
    BracketMatchupAdmin,
    BracketSeedAdmin,
)
from app.api.deps import require_super_admin
from app.bracket.generation import BracketGenerationError, generate_bracket
from app.db import get_db
from app.models import (
    Bracket,
    BracketMatchup,
    BracketSeed,
    BracketStatus,
    Season,
    SeasonStatus,
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
    matchups = db.execute(
        select(BracketMatchup)
        .where(BracketMatchup.bracket_id == bracket.id)
        .order_by(BracketMatchup.round, BracketMatchup.id)
    ).scalars().all()
    return BracketAdminResponse(
        id=bracket.id,
        season_id=bracket.season_id,
        size=bracket.size,
        status=bracket.status,
        seeds=[BracketSeedAdmin.model_validate(s) for s in seeds],
        matchups=[BracketMatchupAdmin.model_validate(m) for m in matchups],
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
