from pydantic import BaseModel, ConfigDict

from app.models import SeasonStatus


class SeasonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus


class LeagueSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    scoring_validated: bool


class SeasonDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    status: SeasonStatus
    playoff_field_per_league: int
    nfl_playoff_weeks: list[int]
    leagues: list[LeagueSummary]
