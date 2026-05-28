-- 0008_teams_unique_name.sql
-- Adds a unique constraint on teams.name so ON CONFLICT (name) upserts work in seed.ts.
-- Before applying: remove any duplicate name rows to avoid constraint violation.

-- Remove higher-ID duplicates, keeping the row with the minimum id (preserves FK refs)
DELETE FROM teams t
WHERE t.id NOT IN (
  SELECT MIN(id) FROM teams GROUP BY name
);

ALTER TABLE teams ADD CONSTRAINT teams_name_unique UNIQUE (name);
