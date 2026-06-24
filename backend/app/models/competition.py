import enum

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class SeasonStatus(enum.Enum):
    SETUP = "setup"
    REGULAR = "regular"
    PLAYOFFS = "playoffs"
    COMPLETE = "complete"


class ScoringRuleset(Base, TimestampMixin):
    __tablename__ = "scoring_ruleset"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    rules: Mapped[dict] = mapped_column(JSON, default=dict)


class Season(Base, TimestampMixin):
    __tablename__ = "season"

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, unique=True)
    status: Mapped[SeasonStatus] = mapped_column(
        Enum(SeasonStatus, name="season_status"), default=SeasonStatus.SETUP
    )
    scoring_ruleset_id: Mapped[int | None] = mapped_column(
        ForeignKey("scoring_ruleset.id", ondelete="SET NULL")
    )
    playoff_field_per_league: Mapped[int] = mapped_column(Integer, default=2)
    nfl_playoff_weeks: Mapped[list] = mapped_column(JSON, default=list)

    leagues: Mapped[list["League"]] = relationship(
        back_populates="season", cascade="all, delete-orphan"
    )


class League(Base, TimestampMixin):
    __tablename__ = "league"
    __table_args__ = (
        UniqueConstraint("season_id", "sleeper_league_id", name="uq_league_season_sleeper"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("season.id", ondelete="CASCADE"))
    sleeper_league_id: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(150))
    commish_sleeper_id: Mapped[str | None] = mapped_column(String(50))
    scoring_validated: Mapped[bool] = mapped_column(Boolean, default=False)

    season: Mapped["Season"] = relationship(back_populates="leagues")
    teams: Mapped[list["Team"]] = relationship(
        back_populates="league", cascade="all, delete-orphan"
    )


class Team(Base):
    __tablename__ = "team"
    __table_args__ = (
        UniqueConstraint("league_id", "sleeper_roster_id", name="uq_team_league_roster"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("league.id", ondelete="CASCADE"))
    sleeper_roster_id: Mapped[int] = mapped_column(Integer)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id", ondelete="SET NULL"))
    sleeper_user_id: Mapped[str | None] = mapped_column(String(50))
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    ties: Mapped[int] = mapped_column(Integer, default=0)
    points_for: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    points_against: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    league_finish: Mapped[int | None] = mapped_column(Integer)

    league: Mapped["League"] = relationship(back_populates="teams")
