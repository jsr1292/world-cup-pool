import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../../data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'pool.db');
export const db = new Database(dbPath);

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    is_admin INTEGER DEFAULT 0
  );

  -- Pools
  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    buy_in REAL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    is_active INTEGER DEFAULT 1,
    deadline_group TEXT,        -- ISO datetime when group predictions lock
    deadline_knockout TEXT,     -- ISO datetime when knockout predictions lock
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Pool members
  CREATE TABLE IF NOT EXISTS pool_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    has_paid INTEGER DEFAULT 0,
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pool_id, user_id)
  );

  -- Teams (static tournament data)
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    flag_code TEXT,             -- e.g. 'ES', 'AR', 'FR'
    group_name TEXT,            -- e.g. 'A', 'B', ... 'L'
    fifa_rank INTEGER
  );

  -- Matches
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fifa_id TEXT,               -- FIFA match ID for API sync
    phase TEXT NOT NULL,        -- 'group', 'r32', 'r16', 'qf', 'sf', '3rd', 'final'
    matchday INTEGER,
    group_name TEXT,            -- only for group stage
    home_team_id INTEGER REFERENCES teams(id),
    away_team_id INTEGER REFERENCES teams(id),
    home_score INTEGER,
    away_score INTEGER,
    status TEXT DEFAULT 'scheduled', -- 'scheduled', 'live', 'finished'
    kickoff TEXT,               -- ISO datetime
    sort_order INTEGER DEFAULT 0
  );

  -- Predictions (one entry per user per pool)
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT DEFAULT '',      -- e.g. '' for main, '2nd entry' for multi-entry
    total_score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pool_id, user_id, label)
  );

  -- Match predictions
  CREATE TABLE IF NOT EXISTS match_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    home_score INTEGER,
    away_score INTEGER,
    -- Derived: outcome (1/X/2) computed from scores
    points_earned INTEGER DEFAULT 0,
    UNIQUE(prediction_id, match_id)
  );

  -- Group standings predictions
  CREATE TABLE IF NOT EXISTS group_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,        -- 'r32', 'r16', 'qf', 'sf', '3rd', 'final'
    slot INTEGER NOT NULL,      -- position in the bracket
    team_id INTEGER REFERENCES teams(id),
    points_earned INTEGER DEFAULT 0,
    UNIQUE(prediction_id, phase, slot)
  );

  -- Scoring config per pool
  CREATE TABLE IF NOT EXISTS scoring_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,         -- e.g. 'match_outcome', 'exact_score', 'group_position', etc.
    points INTEGER NOT NULL DEFAULT 0,
    UNIQUE(pool_id, rule)
  );

  -- Sessions
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Tiebreaker: predicted final score
  CREATE TABLE IF NOT EXISTS tiebreaker (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE CASCADE,
    home_score INTEGER,
    away_score INTEGER
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_pool_members_user ON pool_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_pool ON predictions(pool_id);
  CREATE INDEX IF NOT EXISTS idx_match_predictions_pred ON match_predictions(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_group_predictions_pred ON group_predictions(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_matches_phase ON matches(phase);
`);
