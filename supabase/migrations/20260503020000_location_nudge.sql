-- Phase 8: add location_updated_at column for per-user 7-day nudge tracking.
-- The update_user_location RPC update and get_users_for_location_nudge function
-- are in 20260503030000_location_nudge_fix.sql (separate migration because
-- CREATE OR REPLACE cannot rename parameters on an existing function).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;
