-- Fix find_nearby_users RPC to use alphanumeric code ordering.
-- The original ORDER BY cast (payload->>'number')::int was written before
-- ADR-015 adopted the { "code": "BRA5" } format and breaks with a cast error.
-- CREATE OR REPLACE overwrites the function in-place with no data migration needed.

SET search_path TO public, extensions;

CREATE OR REPLACE FUNCTION find_nearby_users(
  p_user_id  UUID,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION,
  p_radius_m DOUBLE PRECISION,
  p_domain   TEXT DEFAULT 'sticker'
)
RETURNS TABLE (
  user_id   UUID,
  name      TEXT,
  items     JSONB,
  dist_m    DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.name,
    jsonb_agg(l.payload ORDER BY l.payload->>'code') AS items,
    ST_Distance(
      u.location::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS dist_m
  FROM users u
  JOIN listings l ON l.user_id = u.id
    AND l.expires_at > NOW()
    AND l.domain = p_domain
  WHERE
    u.id != p_user_id
    AND ST_DWithin(
      u.location::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
  GROUP BY u.id, u.name, u.location
  ORDER BY dist_m ASC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
