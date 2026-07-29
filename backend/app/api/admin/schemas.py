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


class LeagueEntryRequest(BaseModel):
    sleeper_league_id: str


class ScoringDiff(BaseModel):
    category: str
    league_value: float
    platform_value: float


class TeamRef(BaseModel):
    team_id: int
    sleeper_roster_id: int
    sleeper_user_id: str | None


class LeagueSetupResponse(BaseModel):
    league_id: int
    name: str
    scoring_validated: bool
    diffs: list[ScoringDiff]
    teams: list[TeamRef]


class OwnerCreate(BaseModel):
    first_name: str
    last_name: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    notes: str | None = None


class OwnerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    notes: str | None = None


class OwnerSleeperLinkRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sleeper_user_id: str
    season: int
    sleeper_display_name: str | None


class OwnerAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    notes: str | None


class OwnerAdminDetail(OwnerAdminResponse):
    sleeper_links: list[OwnerSleeperLinkRef]
