from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.admin.schemas import SyncNowResponse
from app.api.deps import get_sleeper_client, require_league_admin
from app.db import get_db
from app.models import League, SeasonStatus, Team, WeeklyScore
from app.sleeper.client import SleeperClient
from app.sleeper.errors import SleeperError, SleeperNotFound
from app.sync.errors import SyncError
from app.sync.ruleset import resolve_ruleset
from app.sync.service import SyncService

router = APIRouter(prefix="/admin", tags=["admin"])

_SYNCABLE = {SeasonStatus.REGULAR, SeasonStatus.PLAYOFFS}


@router.post("/leagues/{league_id}/sync", response_model=SyncNowResponse)
async def sync_league_now(
    league_id: int,
    db: Session = Depends(get_db),
    client: SleeperClient = Depends(get_sleeper_client),
    _account=Depends(require_league_admin),
) -> SyncNowResponse:
    league = db.get(League, league_id)
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")
    season = league.season
    if season.status not in _SYNCABLE:
        raise HTTPException(
            status_code=409,
            detail="League season is not syncable (use resync-setup during setup)",
        )
    try:
        nfl_state = await client.get_nfl_state()
        if season.year != int(nfl_state.season):
            # Not a Sleeper/Sync error — propagates past the except clauses below.
            raise HTTPException(
                status_code=409,
                detail="Manual sync only supports the current active season",
            )
        week = nfl_state.week
        ruleset = resolve_ruleset(db, season)
        result = await SyncService(client, db, season, ruleset).sync_week(
            league_id, week
        )
    except SleeperNotFound:
        raise HTTPException(status_code=422, detail="Sleeper data not found")
    except (SleeperError, SyncError):
        raise HTTPException(status_code=502, detail="Sleeper upstream error")

    db.commit()
    mismatches = db.execute(
        select(func.count())
        .select_from(WeeklyScore)
        .join(Team, WeeklyScore.team_id == Team.id)
        .where(
            Team.league_id == league_id,
            WeeklyScore.week == week,
            WeeklyScore.mismatch_flag.is_(True),
        )
    ).scalar_one()
    return SyncNowResponse(
        league_id=league_id,
        week=week,
        teams_synced=len(result.scored_team_ids),
        rosters_skipped=len(result.skipped_roster_ids),
        mismatches=mismatches,
    )
