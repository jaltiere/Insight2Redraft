from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    AccountAdminResponse,
    AccountCreate,
    AccountPasswordReset,
    LeagueGrantRef,
)
from app.api.deps import require_super_admin
from app.api.security import hash_password
from app.db import get_db
from app.models import Account, AccountRole, League, LeagueAdminGrant, Owner

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _grants_for(db: Session, account_id: int) -> list[LeagueGrantRef]:
    rows = db.execute(
        select(League.id, League.name)
        .join(LeagueAdminGrant, LeagueAdminGrant.league_id == League.id)
        .where(LeagueAdminGrant.account_id == account_id)
        .order_by(League.id)
    ).all()
    return [LeagueGrantRef(league_id=lid, league_name=lname) for lid, lname in rows]


def _account_resp(db: Session, account: Account) -> AccountAdminResponse:
    return AccountAdminResponse(
        id=account.id,
        email=account.email,
        role=account.role,
        owner_id=account.owner_id,
        grants=_grants_for(db, account.id),
    )


@router.post("/accounts", response_model=AccountAdminResponse, status_code=201)
def create_account(
    body: AccountCreate, db: Session = Depends(get_db)
) -> AccountAdminResponse:
    if body.owner_id is not None and db.get(Owner, body.owner_id) is None:
        raise HTTPException(status_code=422, detail="Owner does not exist")
    existing = db.execute(
        select(Account).where(Account.email == body.email)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Account email already exists")
    account = Account(
        email=body.email,
        password_hash=hash_password(body.password),
        role=AccountRole.LEAGUE_ADMIN,
        owner_id=body.owner_id,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account email already exists")
    db.refresh(account)
    return _account_resp(db, account)


@router.get("/accounts", response_model=list[AccountAdminResponse])
def list_accounts(db: Session = Depends(get_db)) -> list[AccountAdminResponse]:
    accounts = db.execute(select(Account).order_by(Account.id)).scalars().all()
    return [_account_resp(db, a) for a in accounts]


@router.patch("/accounts/{account_id}", response_model=AccountAdminResponse)
def reset_password(
    account_id: int, body: AccountPasswordReset, db: Session = Depends(get_db)
) -> AccountAdminResponse:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    account.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(account)
    return _account_resp(db, account)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)) -> None:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.role is AccountRole.SUPER_ADMIN:
        others = db.execute(
            select(func.count())
            .select_from(Account)
            .where(Account.role == AccountRole.SUPER_ADMIN, Account.id != account_id)
        ).scalar_one()
        if others == 0:
            raise HTTPException(
                status_code=409, detail="Cannot delete the last super admin"
            )
    db.delete(account)
    db.commit()
