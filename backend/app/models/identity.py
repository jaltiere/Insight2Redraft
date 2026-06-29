import enum

from sqlalchemy import Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AccountRole(enum.Enum):
    SUPER_ADMIN = "super_admin"
    LEAGUE_ADMIN = "league_admin"


# NOTE: LeagueAdminGrant is added to this module in Task 3 (it FKs the `league`
# table, which Task 3 creates).


class Owner(Base, TimestampMixin):
    __tablename__ = "owner"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(String)

    sleeper_links: Mapped[list["OwnerSleeperLink"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class OwnerSleeperLink(Base):
    __tablename__ = "owner_sleeper_link"
    __table_args__ = (
        UniqueConstraint("sleeper_user_id", "season", name="uq_sleeper_link_user_season"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owner.id", ondelete="CASCADE"))
    sleeper_user_id: Mapped[str] = mapped_column(String(50))
    sleeper_display_name: Mapped[str | None] = mapped_column(String(100))
    season: Mapped[int] = mapped_column(Integer)

    owner: Mapped["Owner"] = relationship(back_populates="sleeper_links")


class Account(Base, TimestampMixin):
    __tablename__ = "account"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AccountRole] = mapped_column(
        Enum(
            AccountRole,
            name="account_role",
            values_callable=lambda e: [m.value for m in e],
        )
    )
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id", ondelete="SET NULL"))


class LeagueAdminGrant(Base):
    __tablename__ = "league_admin_grant"
    __table_args__ = (
        UniqueConstraint("account_id", "league_id", name="uq_league_admin_grant"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    league_id: Mapped[int] = mapped_column(ForeignKey("league.id", ondelete="CASCADE"))
