-- Adds find_nearby_users_for(p_user_id, p_domain) which reads the caller's
-- location and radius_km from the users table internally.
-- This keeps snapped coordinates inside SQL and out of application code (ADR-018).

SET search_path TO public, extensions;

CREATE OR REPLACE FUNCTION find_nearby_users_for(
  p_user_id UUID,
  p_domain  TEXT DEFAULT 'sticker'
)
RETURNS TABLE (
  user_id UUID,
  name    TEXT,
  items   JSONB,
  dist_m  DOUBLE PRECISION
) AS $$
DECLARE
  v_location GEOMETRY;
  v_radius_m DOUBLE PRECISION;
BEGIN
  SELECT location, radius_km * 1000
    INTO v_location, v_radius_m
    FROM users
   WHERE id = p_user_id;

  IF v_location IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.name,
    jsonb_agg(l.payload ORDER BY l.payload->>'code') AS items,
    ST_Distance(u.location::geography, v_location::geography) AS dist_m
  FROM users u
  JOIN listings l ON l.user_id = u.id
    AND l.expires_at > NOW()
    AND l.domain = p_domain
  WHERE
    u.id != p_user_id
    AND ST_DWithin(u.location::geography, v_location::geography, v_radius_m)
  GROUP BY u.id, u.name, u.location
  ORDER BY dist_m ASC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
