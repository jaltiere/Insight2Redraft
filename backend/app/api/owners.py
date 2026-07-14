from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.public_schemas import BestWeeklyEntry, OwnerProfile, OwnerSeasonRecord
from app.db import get_db
from app.history.service import owner_best_weekly, owner_season_records
from app.models import Owner

router = APIRouter(tags=["public"])


@router.get("/owners/{owner_id}", response_model=OwnerProfile)
def get_owner(owner_id: int, db: Session = Depends(get_db)) -> OwnerProfile:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    return OwnerProfile(
        id=owner.id,
        first_name=owner.first_name,
        last_name=owner.last_name,
        display_name=owner.display_name,
        avatar_url=owner.avatar_url,
        season_records=[
            OwnerSeasonRecord.model_validate(r) for r in owner_season_records(db, owner_id)
        ],
        best_weekly=[
            BestWeeklyEntry.model_validate(r) for r in owner_best_weekly(db, owner_id)
        ],
    )
