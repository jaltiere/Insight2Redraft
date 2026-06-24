import enum
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BracketStatus(enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETE = "complete"


class QualifiedVia(enum.Enum):
    AUTO = "auto"
    WILDCARD = "wildcard"


class Bracket(Base):
    __tablename__ = "bracket"

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(
        ForeignKey("season.id", ondelete="CASCADE"), unique=True
    )
    size: Mapped[int] = mapped_column(Integer)
    status: Mapped[BracketStatus] = mapped_column(
        Enum(BracketStatus, name="bracket_status"), default=BracketStatus.PENDING
    )


class BracketSeed(Base):
    __tablename__ = "bracket_seed"
    __table_args__ = (
        UniqueConstraint("bracket_id", "seed", name="uq_bracket_seed_position"),
        UniqueConstraint("bracket_id", "team_id", name="uq_bracket_seed_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bracket_id: Mapped[int] = mapped_column(ForeignKey("bracket.id", ondelete="CASCADE"))
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id", ondelete="CASCADE"))
    seed: Mapped[int] = mapped_column(Integer)
    qualified_via: Mapped[QualifiedVia] = mapped_column(
        Enum(QualifiedVia, name="qualified_via"), default=QualifiedVia.AUTO
    )


class BracketMatchup(Base):
    __tablename__ = "bracket_matchup"

    id: Mapped[int] = mapped_column(primary_key=True)
    bracket_id: Mapped[int] = mapped_column(ForeignKey("bracket.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column(Integer)
    nfl_week: Mapped[int] = mapped_column(Integer)
    team_a_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    team_b_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    team_a_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    team_b_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    winner_team_id: Mapped[int | None] = mapped_column(ForeignKey("team.id", ondelete="SET NULL"))
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    bye: Mapped[bool] = mapped_column(Boolean, default=False)
