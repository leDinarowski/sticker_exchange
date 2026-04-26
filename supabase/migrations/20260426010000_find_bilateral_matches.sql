-- Index for bilateral query: filtering wanted_listings by user + domain.
CREATE INDEX IF NOT EXISTS idx_wanted_listings_user_domain
  ON wanted_listings (user_id, domain);

-- find_bilateral_matches_for(p_user_id, p_domain)
-- Returns nearby users where:
--   1. They have at least one active listing that the caller wants.
--   2. They want at least one active listing the caller has.
-- items = what they have that the caller wants (relevant overlap only).
-- Follows same pattern as find_nearby_users_for (ADR-018).

SET search_path TO public, extensions;

CREATE OR REPLACE FUNCTION find_bilateral_matches_for(
  p_user_id UUID,
  p_domain   TEXT DEFAULT 'sticker'
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
  -- Their active listings that I want (JOIN acts as filter for condition 1)
  JOIN listings l ON l.user_id = u.id
    AND l.expires_at > NOW()
    AND l.domain = p_domain
  JOIN wanted_listings wm ON wm.user_id = p_user_id
    AND wm.domain = p_domain
    AND wm.payload->>'code' = l.payload->>'code'
  WHERE
    u.id != p_user_id
    AND ST_DWithin(u.location::geography, v_location::geography, v_radius_m)
    -- Condition 2: they want at least one item I have
    AND EXISTS (
      SELECT 1
      FROM wanted_listings wt
      JOIN listings lm ON lm.user_id = p_user_id
        AND lm.expires_at > NOW()
        AND lm.domain = p_domain
        AND lm.payload->>'code' = wt.payload->>'code'
      WHERE wt.user_id = u.id
        AND wt.domain = p_domain
    )
  GROUP BY u.id, u.name, u.location
  ORDER BY dist_m ASC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
