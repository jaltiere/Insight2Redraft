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

export interface WeeklyScoreEntry {
  week: number;
  points: number;
  is_final: boolean;
}

export interface TeamDetail {
  id: number;
  league_id: number;
  league_name: string;
  season_year: number;
  owner: OwnerRef | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
  weekly_scores: WeeklyScoreEntry[];
}

export interface SeasonAdminResponse {
  id: number;
  year: number;
  status: SeasonStatus;
  scoring_ruleset_id: number | null;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
}

export interface SeasonCreateBody {
  year: number;
  playoff_field_per_league: number;
  nfl_playoff_weeks: number[];
  status: SeasonStatus;
}

export interface SeasonUpdateBody {
  playoff_field_per_league?: number;
  nfl_playoff_weeks?: number[];
  status?: SeasonStatus;
}

export interface ScoringDiff {
  category: string;
  league_value: number;
  platform_value: number;
}

export interface LeagueSetupResponse {
  league_id: number;
  name: string;
  scoring_validated: boolean;
  diffs: ScoringDiff[];
  teams: { team_id: number; sleeper_roster_id: number; sleeper_user_id: string | null }[];
}

export interface SyncNowResponse {
  league_id: number;
  week: number;
  teams_synced: number;
  rosters_skipped: number;
  mismatches: number;
}

export interface OwnerAdminResponse {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  notes: string | null;
}

export interface OwnerSleeperLinkRef {
  sleeper_user_id: string;
  season: number;
  sleeper_display_name: string | null;
}

export interface OwnerAdminDetail extends OwnerAdminResponse {
  sleeper_links: OwnerSleeperLinkRef[];
}

export interface OwnerCreateBody {
  first_name: string;
  last_name: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  notes?: string | null;
}

export type OwnerUpdateBody = Partial<OwnerCreateBody>;

export interface TeamMappingRow {
  team_id: number;
  sleeper_roster_id: number;
  sleeper_user_id: string | null;
  sleeper_display_name: string | null;
  owner: OwnerRef | null;
}

export interface OwnerSeasonRecord {
  season_year: number;
  league_id: number;
  league_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  league_finish: number | null;
}

export interface BestWeeklyEntry {
  season_year: number;
  league_name: string;
  week: number;
  points: number;
}

export interface OwnerProfile {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
  season_records: OwnerSeasonRecord[];
  best_weekly: BestWeeklyEntry[];
}

export interface LeagueGrantRef {
  league_id: number;
  league_name: string;
}

export interface AccountAdminResponse {
  id: number;
  email: string;
  role: AccountRole;
  owner_id: number | null;
  grants: LeagueGrantRef[];
}

export interface AccountCreateBody {
  email: string;
  password: string;
  owner_id: number | null;
}

export interface LeagueAdminRef {
  id: number;
  name: string;
  season_year: number;
}

export type BracketStatus = "pending" | "active" | "complete";
export type QualifiedVia = "auto" | "wildcard";

export interface BracketTeamRef {
  team_id: number;
  seed: number;
  league_name: string;
  owner: OwnerRef | null;
}

export interface BracketSeedAdmin {
  seed: number;
  team_id: number;
  qualified_via: QualifiedVia;
  league_name: string;
  owner: OwnerRef | null;
}

export interface BracketMatchupAdmin {
  id: number;
  round: number;
  nfl_week: number;
  team_a: BracketTeamRef | null;
  team_b: BracketTeamRef | null;
  team_a_score: number | null;
  team_b_score: number | null;
  winner_team_id: number | null;
  is_finalized: boolean;
  bye: boolean;
}

export interface BracketAdminResponse {
  id: number;
  season_id: number;
  size: number;
  status: BracketStatus;
  seeds: BracketSeedAdmin[];
  matchups: BracketMatchupAdmin[];
}
