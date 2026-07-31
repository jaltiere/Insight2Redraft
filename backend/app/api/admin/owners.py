from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    OwnerAdminDetail,
    OwnerAdminResponse,
    OwnerCreate,
    OwnerUpdate,
)
from app.api.deps import get_current_account, require_super_admin
from app.db import get_db
from app.models import Owner

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/owners", response_model=OwnerAdminResponse, status_code=201)
def create_owner(
    body: OwnerCreate,
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> Owner:
    if body.email is not None:
        existing = db.execute(
            select(Owner).where(Owner.email == body.email)
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Owner email already exists")
    owner = Owner(**body.model_dump())
    db.add(owner)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Owner email already exists")
    db.refresh(owner)
    return owner


@router.get("/owners", response_model=list[OwnerAdminResponse])
def list_owners(
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> list[Owner]:
    stmt = select(Owner)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Owner.first_name.ilike(pattern),
                Owner.last_name.ilike(pattern),
                Owner.display_name.ilike(pattern),
                Owner.email.ilike(pattern),
            )
        )
    stmt = stmt.order_by(Owner.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


@router.get("/owners/{owner_id}", response_model=OwnerAdminDetail)
def get_owner(
    owner_id: int,
    db: Session = Depends(get_db),
    _account=Depends(get_current_account),
) -> Owner:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    return owner


@router.patch("/owners/{owner_id}", response_model=OwnerAdminResponse)
def update_owner(
    owner_id: int,
    body: OwnerUpdate,
    db: Session = Depends(get_db),
    _account=Depends(require_super_admin),
) -> Owner:
    owner = db.get(Owner, owner_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner not found")
    data = body.model_dump(exclude_unset=True)
    new_email = data.get("email")
    if new_email is not None and new_email != owner.email:
        clash = db.execute(
            select(Owner).where(Owner.email == new_email)
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Owner email already exists")
    for field, value in data.items():
        setattr(owner, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Owner email already exists")
    db.refresh(owner)
    return owner
