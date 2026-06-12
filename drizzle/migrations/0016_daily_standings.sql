-- 0016_daily_standings.sql
-- Daily leaderboard snapshots, for "matchday movers" (rank/score change since the
-- last scored day). One row per entry per calendar day, written at the first
-- rescore of the day BEFORE that day's new results are applied — so comparing the
-- snapshot to the live standings shows the day's movement.

CREATE TABLE IF NOT EXISTS daily_standings (
  pool_id       INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  snap_date     DATE    NOT NULL,
  total_score   INTEGER NOT NULL,
  rank          INTEGER NOT NULL,
  PRIMARY KEY (pool_id, prediction_id, snap_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_standings_pool_date ON daily_standings (pool_id, snap_date DESC);
