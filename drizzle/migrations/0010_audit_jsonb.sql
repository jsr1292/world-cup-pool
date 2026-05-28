-- Convert audit_log JSON columns to JSONB for queryability
ALTER TABLE audit_log
  ALTER COLUMN old_value TYPE JSONB USING old_value::JSONB,
  ALTER COLUMN new_value TYPE JSONB USING new_value::JSONB;
