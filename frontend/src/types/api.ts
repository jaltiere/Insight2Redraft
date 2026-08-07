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
