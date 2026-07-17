from pydantic import BaseModel, ConfigDict, Field

from app.models import SeasonStatus


class SeasonCreate(BaseModel):
    year: int
    scoring_ruleset_id: int | None = None
    playoff_field_per_league: int = 2
    nfl_playoff_weeks: list[int] = Field(default_factory=list)
    status: SeasonStatus = SeasonStatus.SETUP


class SeasonUpdate(BaseModel):
    scoring_ruleset_id: int | None = None
    playoff_field_per_league: int | None = None
    nfl_playoff_weeks: list[int] | None = None
    status: SeasonStatus | None = None


class SeasonAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus
    scoring_ruleset_id: int | None
    playoff_field_per_league: int
    nfl_playoff_weeks: list[int]
