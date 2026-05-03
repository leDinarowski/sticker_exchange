-- Security hardening: enable RLS and revoke anon/authenticated access
-- across the entire public schema.
--
-- service_role (used by the backend) bypasses RLS in Supabase — no app changes needed.
-- ENABLE ROW LEVEL SECURITY with no policies = implicit deny for anon/authenticated.
-- REVOKE statements provide defence-in-depth at the privilege layer.

-- ── Tables ───────────────────────────────────────────────────────────────────

ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wanted_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_places  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON users           FROM anon, authenticated;
REVOKE ALL ON listings        FROM anon, authenticated;
REVOKE ALL ON wanted_listings FROM anon, authenticated;
REVOKE ALL ON matches         FROM anon, authenticated;
REVOKE ALL ON meeting_places  FROM anon, authenticated;

-- ── Functions ────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION update_user_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION find_nearby_users(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION find_nearby_users_for(UUID, TEXT)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION find_bilateral_matches_for(UUID, TEXT)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION get_users_needing_expiry_nudge()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION check_rate_limit(UUID)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION get_users_for_location_nudge()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION find_nearest_meeting_place_for_users(UUID, UUID, INT)
  FROM anon, authenticated;
