from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import OwnerRef, TeamMappingRow, TeamOwnerAssign
from app.api.deps import require_league_admin
from app.db import get_db
from app.models import League, Owner, OwnerSleeperLink, Team

router = APIRouter(prefix="/admin", tags=["admin"])


def _row(db: Session, team: Team) -> TeamMappingRow:
    owner = db.get(Owner, team.owner_id) if team.owner_id is not None else None
    return TeamMappingRow(
        team_id=team.id,
        sleeper_roster_id=team.sleeper_roster_id,
        sleeper_user_id=team.sleeper_user_id,
        sleeper_display_name=team.sleeper_display_name,
        owner=OwnerRef.model_validate(owner) if owner is not None else None,
    )


@router.get("/leagues/{league_id}/teams", response_model=list[TeamMappingRow])
def list_team_mappings(
    league_id: int,
    db: Session = Depends(get_db),
    _account=Depends(require_league_admin),
) -> list[TeamMappingRow]:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    teams = (
        db.execute(
            select(Team)
            .where(Team.league_id == league_id)
            .order_by(Team.sleeper_roster_id)
        )
        .scalars()
        .all()
    )
    return [_row(db, t) for t in teams]


@router.patch(
    "/leagues/{league_id}/teams/{team_id}", response_model=TeamMappingRow
)
def assign_team_owner(
    league_id: int,
    team_id: int,
    body: TeamOwnerAssign,
    db: Session = Depends(get_db),
    _account=Depends(require_league_admin),
) -> TeamMappingRow:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    team = db.get(Team, team_id)
    if team is None or team.league_id != league_id:
        raise HTTPException(status_code=404, detail="Team not found in league")
    owner = db.get(Owner, body.owner_id)
    if owner is None:
        raise HTTPException(status_code=422, detail="Owner does not exist")

    team.owner_id = owner.id
    if team.sleeper_user_id is not None:
        link = db.execute(
            select(OwnerSleeperLink).where(
                OwnerSleeperLink.sleeper_user_id == team.sleeper_user_id,
                OwnerSleeperLink.season == league.season.year,
            )
        ).scalar_one_or_none()
        if link is None:
            link = OwnerSleeperLink(
                sleeper_user_id=team.sleeper_user_id,
                season=league.season.year,
            )
            db.add(link)
        link.owner_id = owner.id
        link.sleeper_display_name = team.sleeper_display_name

    db.commit()
    db.refresh(team)
    return _row(db, team)
