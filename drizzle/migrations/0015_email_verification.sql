-- 0015_email_verification.sql
-- Email verification: when SMTP is configured, new registrations must confirm
-- their address via an emailed link before they can log in.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Grandfather every EXISTING account as verified so enabling verification never
-- locks out current users. Only accounts created from now on start unverified.
UPDATE users
   SET email_verified_at = COALESCE(created_at, NOW())
 WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the raw token; the raw value is only ever in the emailed link.
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_expires ON email_verification_tokens(expires_at);
