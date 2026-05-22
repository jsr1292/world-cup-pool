// Row types for database tables — mirrors the PostgreSQL schema

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: Date;
}

export interface Pool {
  id: number;
  name: string;
  invite_code: string;
  created_by: number;
  buy_in: number;
  allow_multiple: boolean;
  deadline_group: Date | null;
  deadline_knockout: Date | null;
  status: string;
  last_scored_at: Date | null;
  last_score_error: string | null;
  created_at: Date;
}

export interface Match {
  id: number;
  fifa_id: string | null;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  phase: string;
  group_name: string | null;
  status: string;
  kickoff_time: Date | null;
  sort_order: number;
}

export interface Prediction {
  id: number;
  user_id: number;
  pool_id: number;
  label: string;
  total_score: number;
  created_at: Date;
  updated_at: Date;
}

export interface MatchPrediction {
  id: number;
  prediction_id: number;
  match_id: number;
  home_score: number;
  away_score: number;
  points_earned: number;
}

export interface GroupPrediction {
  id: number;
  prediction_id: number;
  group_name: string;
  position_1: number | null;
  position_2: number | null;
  position_3: number | null;
  position_4: number | null;
  points_earned: number;
}

export interface BracketPrediction {
  id: number;
  prediction_id: number;
  phase: string;
  slot: number;
  team_id: number | null;
  points_earned: number;
}
