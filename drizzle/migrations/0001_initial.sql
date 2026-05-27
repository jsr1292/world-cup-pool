-- World Cup Pool — Initial PostgreSQL Schema
-- Migration: 0001_initial.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_admin BOOLEAN DEFAULT FALSE
);

-- Pools
CREATE TABLE IF NOT EXISTS pools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  buy_in NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  is_active BOOLEAN DEFAULT TRUE,
  deadline_group TIMESTAMPTZ,
  deadline_knockout TIMESTAMPTZ,
  allow_multiple_predictions BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool members
CREATE TABLE IF NOT EXISTS pool_members (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  has_paid BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, user_id)
);

-- Teams (static tournament data)
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  flag_code TEXT,
  group_name TEXT,
  fifa_rank INTEGER
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  fifa_id TEXT,
  phase TEXT NOT NULL,
  matchday INTEGER,
  group_name TEXT,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  status TEXT DEFAULT 'scheduled',
  kickoff TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0
);

-- Predictions (one entry per user per pool)
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  has_paid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id, user_id, label)
);

-- Match predictions
CREATE TABLE IF NOT EXISTS match_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER,
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, match_id)
);

-- Group standings predictions
CREATE TABLE IF NOT EXISTS group_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  position_1 INTEGER REFERENCES teams(id),
  position_2 INTEGER REFERENCES teams(id),
  position_3 INTEGER REFERENCES teams(id),
  position_4 INTEGER REFERENCES teams(id),
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, group_name)
);

-- Knockout bracket predictions
CREATE TABLE IF NOT EXISTS bracket_predictions (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  slot INTEGER NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  points_earned INTEGER DEFAULT 0,
  UNIQUE(prediction_id, phase, slot)
);

-- Scoring config per pool
CREATE TABLE IF NOT EXISTS scoring_config (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pool_id, rule)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tiebreaker: predicted final score
CREATE TABLE IF NOT EXISTS tiebreaker (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER
);

-- Site-wide settings
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO site_settings (key, value) VALUES ('can_create_pools', 'admin')
  ON CONFLICT DO NOTHING;

-- Users allowed to create pools (when mode is 'admin')
CREATE TABLE IF NOT EXISTS pool_creators (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pool_members_user ON pool_members(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_pool ON predictions(pool_id);
CREATE INDEX IF NOT EXISTS idx_match_predictions_pred ON match_predictions(prediction_id);
CREATE INDEX IF NOT EXISTS idx_group_predictions_pred ON group_predictions(prediction_id);
CREATE INDEX IF NOT EXISTS idx_matches_phase ON matches(phase);
CREATE INDEX IF NOT EXISTS idx_bracket_predictions_pred ON bracket_predictions(prediction_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_phase_status ON matches(phase, status);
CREATE INDEX IF NOT EXISTS idx_pools_is_active ON pools(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
