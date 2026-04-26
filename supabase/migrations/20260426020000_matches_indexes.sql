-- Phase 6: indexes for match lookups by initiator, respondent, and status
CREATE INDEX IF NOT EXISTS matches_user_a_idx ON matches (user_a_id);
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON matches (user_b_id);
CREATE INDEX IF NOT EXISTS matches_status_idx  ON matches (status);
