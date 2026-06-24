from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class WeeklyScore(Base):
    __tablename__ = "weekly_score"
    __table_args__ = (
        UniqueConstraint("team_id", "week", name="uq_weekly_score_team_week"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id", ondelete="CASCADE"))
    week: Mapped[int] = mapped_column(Integer)
    sleeper_points: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    recomputed_points: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    bench_points: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    mismatch_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)


class Player(Base, TimestampMixin):
    __tablename__ = "player"

    id: Mapped[int] = mapped_column(primary_key=True)
    sleeper_player_id: Mapped[str] = mapped_column(String(50), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(150))
    position: Mapped[str | None] = mapped_column(String(10))
    nfl_team: Mapped[str | None] = mapped_column(String(10))


class PlayerStatCache(Base):
    __tablename__ = "player_stat_cache"
    __table_args__ = (
        UniqueConstraint(
            "sleeper_player_id", "season", "week", name="uq_player_stat_cache"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sleeper_player_id: Mapped[str] = mapped_column(String(50))
    season: Mapped[int] = mapped_column(Integer)
    week: Mapped[int] = mapped_column(Integer)
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
