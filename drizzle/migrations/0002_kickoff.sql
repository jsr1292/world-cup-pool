-- 0002: Rename kickoff → kickoff_time for clarity, add per-match deadline enforcement
ALTER TABLE matches RENAME COLUMN kickoff TO kickoff_time;
