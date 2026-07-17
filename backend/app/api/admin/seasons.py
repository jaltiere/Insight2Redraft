from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.schemas import SeasonAdminResponse, SeasonCreate, SeasonUpdate
from app.api.deps import require_super_admin
from app.db import get_db
from app.models import Season

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


@router.post("/seasons", response_model=SeasonAdminResponse, status_code=201)
def create_season(body: SeasonCreate, db: Session = Depends(get_db)) -> Season:
    existing = db.execute(
        select(Season).where(Season.year == body.year)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Season year already exists")
    season = Season(
        year=body.year,
        scoring_ruleset_id=body.scoring_ruleset_id,
        playoff_field_per_league=body.playoff_field_per_league,
        nfl_playoff_weeks=body.nfl_playoff_weeks,
        status=body.status,
    )
    db.add(season)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Season year already exists")
    db.refresh(season)
    return season


@router.patch("/seasons/{season_id}", response_model=SeasonAdminResponse)
def update_season(
    season_id: int, body: SeasonUpdate, db: Session = Depends(get_db)
) -> Season:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(season, field, value)
    db.commit()
    db.refresh(season)
    return season
