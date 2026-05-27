-- Track scoring status
DO $$ BEGIN
	ALTER TABLE pools ADD COLUMN last_scored_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN
	RAISE NOTICE 'Column last_scored_at already exists, skipping.';
END $$;

DO $$ BEGIN
	ALTER TABLE pools ADD COLUMN last_score_error TEXT;
EXCEPTION WHEN duplicate_column THEN
	RAISE NOTICE 'Column last_score_error already exists, skipping.';
END $$;
