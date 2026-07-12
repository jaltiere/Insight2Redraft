from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.api.security import (
    InvalidToken,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.config import settings
from app.models import AccountRole


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("s3cret!")
    assert hashed != "s3cret!"
    assert verify_password("s3cret!", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("s3cret!")
    assert verify_password("wrong", hashed) is False


def test_access_token_roundtrip_carries_sub_and_role():
    token = create_access_token(42, AccountRole.SUPER_ADMIN)
    claims = decode_access_token(token)
    assert claims["sub"] == "42"
    assert claims["role"] == "super_admin"
    assert claims["exp"] > claims["iat"]


def test_decode_rejects_token_signed_with_wrong_secret():
    now = datetime.now(UTC)
    forged = jwt.encode(
        {"sub": "1", "role": "super_admin", "iat": now, "exp": now + timedelta(hours=1)},
        "not-the-real-secret",
        algorithm="HS256",
    )
    with pytest.raises(InvalidToken):
        decode_access_token(forged)


def test_decode_rejects_expired_token():
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": "1",
            "role": "super_admin",
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(InvalidToken):
        decode_access_token(expired)


def test_decode_rejects_malformed_token():
    with pytest.raises(InvalidToken):
        decode_access_token("not-a-jwt")
