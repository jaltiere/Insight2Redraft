from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import LeagueSummary, SeasonDetail, SeasonSummary
from app.db import get_db
from app.models import League, Season

router = APIRouter(tags=["public"])


@router.get("/seasons", response_model=list[SeasonSummary])
def list_seasons(db: Session = Depends(get_db)) -> list[Season]:
    return list(
        db.execute(select(Season).order_by(Season.year.desc())).scalars().all()
    )


@router.get("/seasons/{season_id}", response_model=SeasonDetail)
def get_season(season_id: int, db: Session = Depends(get_db)) -> SeasonDetail:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    leagues = db.execute(
        select(League).where(League.season_id == season_id).order_by(League.name)
    ).scalars().all()
    return SeasonDetail(
        id=season.id,
        year=season.year,
        status=season.status,
        playoff_field_per_league=season.playoff_field_per_league,
        nfl_playoff_weeks=season.nfl_playoff_weeks,
        leagues=[LeagueSummary.model_validate(lg) for lg in leagues],
    )
