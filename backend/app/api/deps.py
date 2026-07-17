from collections.abc import AsyncGenerator, Callable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.security import InvalidToken, decode_access_token
from app.db import get_db
from app.models import Account, AccountRole, LeagueAdminGrant
from app.sleeper.client import SleeperClient

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Account:
    if credentials is None:
        raise _unauthorized()
    try:
        claims = decode_access_token(credentials.credentials)
        account_id = int(claims["sub"])
    except (InvalidToken, KeyError, ValueError):
        raise _unauthorized()
    account = db.get(Account, account_id)
    if account is None:
        raise _unauthorized()
    return account


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="Forbidden")


def require_super_admin(account: Account = Depends(get_current_account)) -> Account:
    if account.role is not AccountRole.SUPER_ADMIN:
        raise _forbidden()
    return account


def require_league_admin(league_id: int) -> Callable[..., Account]:
    def dependency(
        account: Account = Depends(get_current_account),
        db: Session = Depends(get_db),
    ) -> Account:
        if account.role is AccountRole.SUPER_ADMIN:
            return account
        grant = db.execute(
            select(LeagueAdminGrant).where(
                LeagueAdminGrant.account_id == account.id,
                LeagueAdminGrant.league_id == league_id,
            )
        ).scalar_one_or_none()
        if grant is None:
            raise _forbidden()
        return account

    return dependency


async def get_sleeper_client() -> AsyncGenerator[SleeperClient, None]:
    client = SleeperClient()
    try:
        yield client
    finally:
        await client.aclose()
