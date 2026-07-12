import argparse
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.security import hash_password
from app.db import SessionLocal
from app.models import Account, AccountRole


def create_superadmin(
    email: str,
    password: str,
    session_factory: Callable[[], Session] = SessionLocal,
) -> str:
    session = session_factory()
    try:
        account = session.execute(
            select(Account).where(Account.email == email)
        ).scalar_one_or_none()
        if account is None:
            session.add(
                Account(
                    email=email,
                    password_hash=hash_password(password),
                    role=AccountRole.SUPER_ADMIN,
                )
            )
            outcome = "created"
        else:
            account.password_hash = hash_password(password)
            account.role = AccountRole.SUPER_ADMIN
            outcome = "updated"
        session.commit()
        return outcome
    finally:
        session.close()


def main(
    argv: list[str] | None = None,
    session_factory: Callable[[], Session] = SessionLocal,
) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser(
        "create-superadmin", help="Create or reset the Super Admin account"
    )
    create.add_argument("--email", required=True)
    create.add_argument("--password", required=True)
    args = parser.parse_args(argv)

    if args.command == "create-superadmin":
        print(create_superadmin(args.email, args.password, session_factory))


if __name__ == "__main__":
    main()
