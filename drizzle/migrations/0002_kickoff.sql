-- 0002: Rename kickoff → kickoff_time for clarity, add per-match deadline enforcement
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'matches' AND column_name = 'kickoff'
	) THEN
		ALTER TABLE matches RENAME COLUMN kickoff TO kickoff_time;
	END IF;
END $$;
