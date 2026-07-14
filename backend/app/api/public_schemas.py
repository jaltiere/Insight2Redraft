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


class OwnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    display_name: str | None
    avatar_url: str | None


class TeamStanding(BaseModel):
    team_id: int
    owner: OwnerRef | None
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


class LeagueDetail(BaseModel):
    id: int
    name: str
    season_id: int
    season_year: int
    scoring_validated: bool
    standings: list[TeamStanding]


class WeeklyScoreEntry(BaseModel):
    week: int
    points: float
    is_final: bool


class TeamDetail(BaseModel):
    id: int
    league_id: int
    league_name: str
    season_year: int
    owner: OwnerRef | None
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None
    weekly_scores: list[WeeklyScoreEntry]


class OwnerSeasonRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season_year: int
    league_id: int
    league_name: str
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float
    league_finish: int | None


class BestWeeklyEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season_year: int
    league_name: str
    week: int
    points: float


class OwnerProfile(BaseModel):
    id: int
    first_name: str
    last_name: str
    display_name: str | None
    avatar_url: str | None
    season_records: list[OwnerSeasonRecord]
    best_weekly: list[BestWeeklyEntry]
