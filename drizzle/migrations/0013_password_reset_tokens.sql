-- 0013_password_reset_tokens.sql
-- Self-service password reset: short-lived, single-use, hashed-at-rest tokens.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the raw token; the raw value is only ever in the emailed link.
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
