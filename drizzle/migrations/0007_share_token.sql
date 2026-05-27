-- 0007_share_token.sql
-- Adds a read-only share token to pools so the public leaderboard URL
-- no longer exposes the join invite_code.

ALTER TABLE pools ADD COLUMN IF NOT EXISTS share_token TEXT;

-- Backfill existing pools with a unique token derived from gen_random_uuid()
UPDATE pools SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;

-- Enforce uniqueness and NOT NULL after backfill
ALTER TABLE pools ALTER COLUMN share_token SET NOT NULL;
ALTER TABLE pools ADD CONSTRAINT pools_share_token_key UNIQUE (share_token);

-- Index for the /s/:share_token lookup
CREATE INDEX IF NOT EXISTS idx_pools_share_token ON pools(share_token);
