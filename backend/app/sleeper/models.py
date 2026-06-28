from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class NflState(_Base):
    season: str
    week: int
    season_type: str
    leg: int | None = None


class SleeperLeague(_Base):
    league_id: str
    name: str
    season: str | None = None
    status: str | None = None
    previous_league_id: str | None = None
    scoring_settings: dict[str, float] = Field(default_factory=dict)
    roster_positions: list[str] = Field(default_factory=list)


class SleeperUser(_Base):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    user_id: str
    display_name: str | None = None
    is_commissioner: bool = Field(default=False, alias="is_owner")

    @field_validator("is_commissioner", mode="before")
    @classmethod
    def _coerce_none_to_false(cls, value: object) -> bool:
        return bool(value) if value is not None else False


class SleeperRosterSettings(_Base):
    wins: int = 0
    losses: int = 0
    ties: int = 0
    fpts: float = 0.0
    fpts_decimal: float = 0.0
    fpts_against: float = 0.0
    fpts_against_decimal: float = 0.0


class SleeperRoster(_Base):
    roster_id: int
    owner_id: str | None = None
    settings: SleeperRosterSettings = Field(default_factory=SleeperRosterSettings)

    @property
    def points_for(self) -> float:
        return round(self.settings.fpts + self.settings.fpts_decimal / 100, 2)

    @property
    def points_against(self) -> float:
        return round(self.settings.fpts_against + self.settings.fpts_against_decimal / 100, 2)


class SleeperMatchup(_Base):
    roster_id: int
    matchup_id: int | None = None
    points: float = 0.0
    players: list[str] = Field(default_factory=list)
    starters: list[str] = Field(default_factory=list)
    players_points: dict[str, float] = Field(default_factory=dict)


class SleeperPlayer(_Base):
    player_id: str
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    position: str | None = None
    team: str | None = None
