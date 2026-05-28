-- Add domain CHECK constraints missing from 0001_initial.sql

ALTER TABLE matches
  ADD CONSTRAINT chk_matches_home_score
    CHECK (home_score IS NULL OR (home_score >= 0 AND home_score <= 30)),
  ADD CONSTRAINT chk_matches_away_score
    CHECK (away_score IS NULL OR (away_score >= 0 AND away_score <= 30)),
  ADD CONSTRAINT chk_matches_phase
    CHECK (phase IN ('group','r32','r16','qf','sf','3rd','final')),
  ADD CONSTRAINT chk_matches_status
    CHECK (status IN ('scheduled','live','finished'));

ALTER TABLE match_predictions
  ADD CONSTRAINT chk_mp_home_score
    CHECK (home_score IS NULL OR (home_score >= 0 AND home_score <= 30)),
  ADD CONSTRAINT chk_mp_away_score
    CHECK (away_score IS NULL OR (away_score >= 0 AND away_score <= 30)),
  ADD CONSTRAINT chk_mp_points
    CHECK (points_earned >= 0);

ALTER TABLE predictions
  ADD CONSTRAINT chk_pred_total_score
    CHECK (total_score >= 0);

ALTER TABLE group_predictions
  ADD CONSTRAINT chk_gp_points
    CHECK (points_earned >= 0);

ALTER TABLE bracket_predictions
  ADD CONSTRAINT chk_bp_points
    CHECK (points_earned >= 0);

-- M2: Replace boolean btree index with partial index
DROP INDEX IF EXISTS idx_pools_is_active;
CREATE INDEX idx_pools_active ON pools (id) WHERE is_active = true;

-- M3: Composite index for leaderboard query
CREATE INDEX IF NOT EXISTS idx_predictions_leaderboard
  ON predictions (pool_id, total_score DESC, updated_at ASC);
