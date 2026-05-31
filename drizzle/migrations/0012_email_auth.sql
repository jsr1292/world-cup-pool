-- 0012_email_auth.sql
-- Email-based authentication: email becomes the login identifier.
--
-- Assumes a fresh database (no legacy NULL-email accounts). On a DB that
-- already has users without an email, backfill emails before applying this.

-- Case-insensitive uniqueness on email (stored lowercased by the app anyway).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));

-- Require an email on every account.
DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN email SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not set users.email NOT NULL (existing NULL emails?). Backfill, then re-run.';
END $$;
