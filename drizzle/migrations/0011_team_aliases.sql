CREATE TABLE IF NOT EXISTS team_aliases (
  id           SERIAL PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias_normalized TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_norm ON team_aliases (alias_normalized);
