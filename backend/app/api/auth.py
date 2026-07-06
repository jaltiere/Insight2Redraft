from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import LoginRequest, TokenResponse
from app.api.security import create_access_token, hash_password, verify_password
from app.db import get_db
from app.models import Account

# Equalizes login timing: unknown emails still pay a full password verify,
# so they aren't distinguishable from wrong passwords by response time.
_DUMMY_PASSWORD_HASH = hash_password("dummy-timing-equalizer")

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    account = db.execute(
        select(Account).where(Account.email == body.email)
    ).scalar_one_or_none()
    hashed = account.password_hash if account is not None else _DUMMY_PASSWORD_HASH
    if not verify_password(body.password, hashed) or account is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenResponse(access_token=create_access_token(account.id, account.role))
