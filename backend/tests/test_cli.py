from sqlalchemy import select

from app.api.security import verify_password
from app.cli import main
from app.models import Account, AccountRole


def test_create_superadmin_creates_account(db_session, capsys):
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "first-pw"],
        session_factory=lambda: db_session,
    )
    assert capsys.readouterr().out.strip() == "created"

    account = db_session.execute(
        select(Account).where(Account.email == "root@example.com")
    ).scalar_one()
    assert account.role is AccountRole.SUPER_ADMIN
    assert verify_password("first-pw", account.password_hash)


def test_create_superadmin_second_call_updates_password(db_session, capsys):
    factory = lambda: db_session  # noqa: E731
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "first-pw"],
        session_factory=factory,
    )
    main(
        ["create-superadmin", "--email", "root@example.com", "--password", "second-pw"],
        session_factory=factory,
    )
    assert capsys.readouterr().out.strip().splitlines() == ["created", "updated"]

    accounts = db_session.execute(
        select(Account).where(Account.email == "root@example.com")
    ).scalars().all()
    assert len(accounts) == 1
    assert accounts[0].role is AccountRole.SUPER_ADMIN
    assert verify_password("second-pw", accounts[0].password_hash)
    assert not verify_password("first-pw", accounts[0].password_hash)
