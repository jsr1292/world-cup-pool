-- Track scoring status
ALTER TABLE pools ADD COLUMN last_scored_at TIMESTAMPTZ;
ALTER TABLE pools ADD COLUMN last_score_error TEXT;
