-- Per-pool banter chat. One row per message. Additive; safe to re-run.
CREATE TABLE IF NOT EXISTS pool_messages (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON pool_messages(pool_id, id);
