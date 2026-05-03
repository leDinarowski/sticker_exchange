-- Fix for 20260503020000: previous migration used wrong parameter names for
-- update_user_location. The existing function uses p_user_id/p_lat/p_lng;
-- CREATE OR REPLACE cannot rename parameters so this migration drops and
-- recreates it. IF NOT EXISTS guards are idempotent in case the ALTER ran.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- DROP is required because CREATE OR REPLACE cannot rename parameters.
DROP FUNCTION IF EXISTS update_user_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION);

CREATE FUNCTION update_user_location(
  p_user_id UUID,
  p_lat     DOUBLE PRECISION,
  p_lng     DOUBLE PRECISION
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE users
     SET location            = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
         location_updated_at = NOW()
   WHERE id = p_user_id;
END;
$$;

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
