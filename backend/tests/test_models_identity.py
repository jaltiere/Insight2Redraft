import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Account, AccountRole, Owner, OwnerSleeperLink


def test_owner_with_sleeper_link_roundtrip(db_session):
    owner = Owner(first_name="Jane", last_name="Doe", email="jane@example.com")
    owner.sleeper_links.append(
        OwnerSleeperLink(sleeper_user_id="123", sleeper_display_name="jdoe", season=2026)
    )
    db_session.add(owner)
    db_session.commit()

    loaded = db_session.query(Owner).filter_by(email="jane@example.com").one()
    assert loaded.first_name == "Jane"
    assert loaded.created_at is not None
    assert len(loaded.sleeper_links) == 1
    assert loaded.sleeper_links[0].season == 2026


def test_account_role_enum_persists(db_session):
    account = Account(
        email="admin@example.com",
        password_hash="x",
        role=AccountRole.SUPER_ADMIN,
    )
    db_session.add(account)
    db_session.commit()

    loaded = db_session.query(Account).filter_by(email="admin@example.com").one()
    assert loaded.role is AccountRole.SUPER_ADMIN


def test_account_role_stored_as_lowercase_value(db_session):
    """The literal string in the column is the enum .value (spec token), not the
    member NAME. Pins the DB/wire representation decision."""
    db_session.add(
        Account(email="repr@example.com", password_hash="x", role=AccountRole.SUPER_ADMIN)
    )
    db_session.commit()

    stored = db_session.execute(
        text("SELECT role::text FROM account WHERE email = 'repr@example.com'")
    ).scalar_one()
    assert stored == "super_admin"


def test_account_email_unique(db_session):
    db_session.add(Account(email="dup@example.com", password_hash="x", role=AccountRole.LEAGUE_ADMIN))
    db_session.commit()
    db_session.add(Account(email="dup@example.com", password_hash="y", role=AccountRole.LEAGUE_ADMIN))
    with pytest.raises(IntegrityError):
        db_session.commit()
