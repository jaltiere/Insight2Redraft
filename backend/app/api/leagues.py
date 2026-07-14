from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public_schemas import (
    LeagueDetail,
    OwnerRef,
    TeamDetail,
    TeamStanding,
    WeeklyScoreEntry,
)
from app.db import get_db
from app.models import League, Owner, Season, Team, WeeklyScore

router = APIRouter(tags=["public"])


def _win_pct(team: Team) -> float:
    games = team.wins + team.losses + team.ties
    if games == 0:
        return -1.0
    return (team.wins + 0.5 * team.ties) / games


def _owner_ref(db: Session, owner_id: int | None) -> OwnerRef | None:
    if owner_id is None:
        return None
    owner = db.get(Owner, owner_id)
    return OwnerRef.model_validate(owner) if owner is not None else None


def _standing(db: Session, team: Team) -> TeamStanding:
    return TeamStanding(
        team_id=team.id,
        owner=_owner_ref(db, team.owner_id),
        wins=team.wins,
        losses=team.losses,
        ties=team.ties,
        points_for=float(team.points_for),
        points_against=float(team.points_against),
        league_finish=team.league_finish,
    )


@router.get("/leagues/{league_id}", response_model=LeagueDetail)
def get_league(league_id: int, db: Session = Depends(get_db)) -> LeagueDetail:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = db.get(Season, league.season_id)
    teams = db.execute(
        select(Team).where(Team.league_id == league_id)
    ).scalars().all()
    ordered = sorted(teams, key=lambda t: (_win_pct(t), float(t.points_for)), reverse=True)
    return LeagueDetail(
        id=league.id,
        name=league.name,
        season_id=league.season_id,
        season_year=season.year,
        scoring_validated=league.scoring_validated,
        standings=[_standing(db, t) for t in ordered],
    )


@router.get("/teams/{team_id}", response_model=TeamDetail)
def get_team(team_id: int, db: Session = Depends(get_db)) -> TeamDetail:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    league = db.get(League, team.league_id)
    season = db.get(Season, league.season_id)
    weeks = db.execute(
        select(WeeklyScore)
        .where(WeeklyScore.team_id == team_id)
        .order_by(WeeklyScore.week)
    ).scalars().all()
    return TeamDetail(
        id=team.id,
        league_id=team.league_id,
        league_name=league.name,
        season_year=season.year,
        owner=_owner_ref(db, team.owner_id),
        wins=team.wins,
        losses=team.losses,
        ties=team.ties,
        points_for=float(team.points_for),
        points_against=float(team.points_against),
        league_finish=team.league_finish,
        weekly_scores=[
            WeeklyScoreEntry(week=ws.week, points=float(ws.sleeper_points), is_final=ws.is_final)
            for ws in weeks
        ],
    )
