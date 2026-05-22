-- Performance indexes
CREATE INDEX idx_matches_fifa_id ON matches(fifa_id) WHERE fifa_id IS NOT NULL;
CREATE INDEX idx_pool_members_pool ON pool_members(pool_id);
CREATE INDEX idx_predictions_user ON predictions(user_id);
