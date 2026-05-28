-- 0006: Add penalty_winner_id to matches for knockout rounds decided by penalties
-- Required for C-03: bracket scoring for matches that finish level after extra time
DO $$ BEGIN
	ALTER TABLE matches ADD COLUMN penalty_winner_id INTEGER REFERENCES teams(id);
EXCEPTION WHEN duplicate_column THEN
	RAISE NOTICE 'Column penalty_winner_id already exists, skipping.';
END $$;
