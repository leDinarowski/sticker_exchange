-- Phase 8: per-user 7-day location nudge window.
--
-- Adds location_updated_at to track the last time a user's location was saved
-- (or when a nudge was sent). The cron endpoint resets this timestamp after each
-- nudge so users are not nudged again until 7 days pass.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Update the existing update_user_location RPC to also stamp location_updated_at.
-- Using CREATE OR REPLACE so the existing function signature is preserved.
CREATE OR REPLACE FUNCTION update_user_location(user_id UUID, lat FLOAT, lng FLOAT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE users
     SET location           = ST_SetSRID(ST_MakePoint(lng, lat), 4326),
         location_updated_at = NOW()
   WHERE id = user_id;
$$;

-- Return users eligible for a location nudge:
--   - Consented to LGPD
--   - Has at least one active listing (still engaged with the system)
--   - Currently IDLE (never interrupt mid-flow)
--   - location_updated_at is NULL (never set) or older than 7 days
CREATE OR REPLACE FUNCTION get_users_for_location_nudge()
RETURNS TABLE(user_id UUID, phone TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT u.id, u.phone
    FROM users u
    JOIN listings l ON l.user_id = u.id
   WHERE l.expires_at > NOW()
     AND (u.conversation_state->>'step') = 'IDLE'
     AND u.consented_at IS NOT NULL
     AND u.phone IS NOT NULL
     AND (
       u.location_updated_at IS NULL
       OR u.location_updated_at < NOW() - INTERVAL '7 days'
     );
$$;
