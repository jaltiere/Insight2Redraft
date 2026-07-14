from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import League, Season, Team, WeeklyScore


@dataclass
class SeasonRecordRow:
    season_year: int
    league_id: int
    league_name: str
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


@dataclass
class BestWeeklyRow:
    season_year: int
    league_name: str
    week: int
    points: float


def owner_season_records(db: Session, owner_id: int) -> list[SeasonRecordRow]:
    rows = db.execute(
        select(Team, League, Season)
        .join(League, Team.league_id == League.id)
        .join(Season, League.season_id == Season.id)
        .where(Team.owner_id == owner_id)
        .order_by(Season.year.desc(), League.name)
    ).all()
    return [
        SeasonRecordRow(
            season_year=season.year,
            league_id=league.id,
            league_name=league.name,
            wins=team.wins,
            losses=team.losses,
            ties=team.ties,
            points_for=float(team.points_for),
            points_against=float(team.points_against),
            league_finish=team.league_finish,
        )
        for team, league, season in rows
    ]


def owner_best_weekly(db: Session, owner_id: int, limit: int = 5) -> list[BestWeeklyRow]:
    rows = db.execute(
        select(WeeklyScore, League, Season)
        .join(Team, WeeklyScore.team_id == Team.id)
        .join(League, Team.league_id == League.id)
        .join(Season, League.season_id == Season.id)
        .where(Team.owner_id == owner_id)
        .order_by(WeeklyScore.sleeper_points.desc())
        .limit(limit)
    ).all()
    return [
        BestWeeklyRow(
            season_year=season.year,
            league_name=league.name,
            week=ws.week,
            points=float(ws.sleeper_points),
        )
        for ws, league, season in rows
    ]
