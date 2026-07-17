from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.schemas import (
    LeagueEntryRequest,
    LeagueSetupResponse,
    ScoringDiff,
    TeamRef,
)
from app.api.deps import get_sleeper_client, require_super_admin
from app.db import get_db
from app.models import League, Season, Team
from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperError, SleeperNotFound
from app.sync.errors import SyncError
from app.sync.ruleset import resolve_ruleset
from app.sync.service import LeagueSyncResult, SyncService

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_super_admin)],
)


def _build_response(db: Session, result: LeagueSyncResult) -> LeagueSetupResponse:
    league = db.get(League, result.league_id)
    teams = db.execute(
        select(Team).where(Team.league_id == result.league_id)
    ).scalars().all()
    return LeagueSetupResponse(
        league_id=league.id,
        name=league.name,
        scoring_validated=result.scoring_validated,
        diffs=[
            ScoringDiff(category=c, league_value=lv, platform_value=pv)
            for c, lv, pv in result.diffs
        ],
        teams=[
            TeamRef(
                team_id=t.id,
                sleeper_roster_id=t.sleeper_roster_id,
                sleeper_user_id=t.sleeper_user_id,
            )
            for t in teams
        ],
    )


async def _run_setup(
    db: Session, client: SleeperClient, season: Season, sleeper_league_id: str
) -> LeagueSetupResponse:
    ruleset = resolve_ruleset(db, season)
    service = SyncService(client, db, season, ruleset)
    try:
        result = await service.sync_league_setup(sleeper_league_id)
    except SleeperNotFound:
        raise HTTPException(status_code=422, detail="Sleeper league not found")
    except (SleeperError, SyncError):
        raise HTTPException(status_code=502, detail="Sleeper upstream error")
    db.commit()
    return _build_response(db, result)


@router.post(
    "/seasons/{season_id}/leagues",
    response_model=LeagueSetupResponse,
    status_code=201,
)
async def enter_league(
    season_id: int,
    body: LeagueEntryRequest,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
) -> LeagueSetupResponse:
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return await _run_setup(db, client, season, body.sleeper_league_id)


@router.post("/leagues/{league_id}/resync-setup", response_model=LeagueSetupResponse)
async def resync_league(
    league_id: int,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
) -> LeagueSetupResponse:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = db.get(Season, league.season_id)
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return await _run_setup(db, client, season, league.sleeper_league_id)


@router.delete("/leagues/{league_id}", status_code=204)
def delete_league(league_id: int, db: Session = Depends(get_db)) -> None:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    db.delete(league)
    db.commit()
