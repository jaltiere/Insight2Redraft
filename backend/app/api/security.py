from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import settings
from app.models.identity import AccountRole

_ALGORITHM = "HS256"

_password_hash = PasswordHash((Argon2Hasher(),))


class InvalidToken(Exception):
    """Raised when a JWT is malformed, tampered with, or expired."""


def hash_password(plain: str) -> str:
    return _password_hash.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _password_hash.verify(plain, hashed)


def create_access_token(account_id: int, role: AccountRole) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(account_id),
        "role": role.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise InvalidToken(str(exc)) from exc
