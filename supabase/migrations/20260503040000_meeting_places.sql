-- Phase 9: meeting places for sticker trades.
--
-- Stores curated business locations (coffee shops, bookstores, etc.) that can
-- be suggested to users when they connect. Managed manually via Supabase.
--
-- To insert a new place:
--   INSERT INTO meeting_places (name, address, neighborhood, location)
--   VALUES ('Cafe X', 'Rua Y, 10', 'Pinheiros',
--           ST_SetSRID(ST_MakePoint(<lng>, <lat>), 4326));
--
-- To deactivate a place (hide from suggestions without deleting):
--   UPDATE meeting_places SET active = false WHERE id = '<uuid>';
--
-- To reactivate:
--   UPDATE meeting_places SET active = true WHERE id = '<uuid>';

CREATE TABLE meeting_places (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  address      TEXT        NOT NULL,
  neighborhood TEXT,
  location     GEOMETRY(Point, 4326) NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX meeting_places_location_idx ON meeting_places USING GIST(location);

-- Returns the single nearest active meeting place within p_radius_m metres
-- of the midpoint between two users. The midpoint is computed from their
-- H3-snapped geometry already stored in the DB — no raw coordinates needed.
CREATE OR REPLACE FUNCTION find_nearest_meeting_place_for_users(
  p_user_a_id UUID,
  p_user_b_id UUID,
  p_radius_m  INT DEFAULT 3000
)
RETURNS TABLE(
  id           UUID,
  name         TEXT,
  address      TEXT,
  neighborhood TEXT,
  distance_m   FLOAT
)
LANGUAGE sql
STABLE
AS $$
  WITH midpoint AS (
    SELECT ST_Centroid(ST_MakeLine(a.location, b.location)) AS geom
      FROM users a
      JOIN users b ON TRUE
     WHERE a.id = p_user_a_id
       AND b.id = p_user_b_id
  )
  SELECT mp.id,
         mp.name,
         mp.address,
         mp.neighborhood,
         ST_Distance(mp.location::geography, midpoint.geom::geography) AS distance_m
    FROM meeting_places mp, midpoint
   WHERE mp.active = TRUE
     AND ST_DWithin(mp.location::geography, midpoint.geom::geography, p_radius_m)
   ORDER BY distance_m ASC
   LIMIT 1;
$$;
