export type SeasonStatus = "setup" | "regular" | "playoffs" | "complete";

export interface SeasonSummary {
  id: number;
  year: number;
  status: SeasonStatus;
}

export type AccountRole = "super_admin" | "league_admin";

export interface Account {
  id: number;
  email: string;
  role: AccountRole;
  owner_id: number | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface ApiError {
  status: number;
  detail: string;
}

export interface OwnerRef {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface LeagueSummary {
  id: number;
  name: string;
  scoring_validated: boolean;
}

export interface SeasonDetail {
  id: number;
  year: number;
  status: SeasonStatus;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
  leagues: LeagueSummary[];
}

export interface TeamStanding {
  team_id: number;
  owner: OwnerRef | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
}

export interface LeagueDetail {
  id: number;
  name: string;
  season_id: number;
  season_year: number;
  scoring_validated: boolean;
  standings: TeamStanding[];
}
