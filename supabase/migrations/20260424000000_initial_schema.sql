-- ─────────────────────────────────────────────────────────────────────────────
-- sticker_exchange — initial schema
-- ─────────────────────────────────────────────────────────────────────────────

-- On Supabase, PostGIS lives in the `extensions` schema by default.
-- Adding it to the search path makes geometry types and ST_* functions
-- available without schema qualification throughout this migration.
SET search_path TO public, extensions;

-- Enable PostGIS for geospatial queries.
-- On Supabase this extension is available but must be explicitly enabled.
CREATE EXTENSION IF NOT EXISTS postgis;


-- ─── users ───────────────────────────────────────────────────────────────────
-- Core identity table. Phone is the WhatsApp identifier today;
-- wa_username is nullable to accommodate the upcoming WA username rollout.
-- Location is stored AFTER H3 snapping (resolution 8, ~460m precision).
-- Exact GPS coordinates are never stored here.

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                 TEXT NOT NULL UNIQUE,
  wa_username           TEXT UNIQUE,
  name                  TEXT,
  -- Geometry stored in WGS84 (SRID 4326). Always H3-snapped before insert.
  location              GEOMETRY(Point, 4326),
  radius_km             INT NOT NULL DEFAULT 3
                          CHECK (radius_km IN (1, 3, 5, 7)),
  -- JSONB state machine payload — see src/types/index.ts for schema
  conversation_state    JSONB,
  -- LGPD consent tracking
  consented_at          TIMESTAMPTZ,
  refused_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast geospatial radius queries require a GIST index.
-- Without this, ST_DWithin degrades to a full table scan.
CREATE INDEX IF NOT EXISTS users_location_gist
  ON users USING GIST (location);

-- Automatic updated_at maintenance
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── listings ────────────────────────────────────────────────────────────────
-- Domain-agnostic "have" table.
-- For stickers: domain = 'sticker', payload = { "number": 45 }
-- Designed to accommodate future domains without schema changes.

CREATE TABLE IF NOT EXISTS listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Prevent duplicate listings for same user/domain/item
  UNIQUE (user_id, domain, payload)
);

CREATE INDEX IF NOT EXISTS listings_user_id_idx
  ON listings (user_id);

CREATE INDEX IF NOT EXISTS listings_expires_at_idx
  ON listings (expires_at);


-- ─── wanted_listings ─────────────────────────────────────────────────────────
-- Domain-agnostic "want" table. Powers "Match Perfeito" bilateral matching.
-- Created from day one alongside listings — retrofitting this later is costly.

CREATE TABLE IF NOT EXISTS wanted_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, domain, payload)
);

CREATE INDEX IF NOT EXISTS wanted_listings_user_id_idx
  ON wanted_listings (user_id);


-- ─── matches ─────────────────────────────────────────────────────────────────
-- Records connection attempts between two users.
-- Status progresses: PENDING → CONFIRMED_B → CONNECTED
-- Or: PENDING → DECLINED | EXPIRED
-- On deletion of a user, we anonymise (null the FK) rather than cascade-delete,
-- to preserve aggregate connection counts.

CREATE TYPE match_status AS ENUM (
  'PENDING',
  'CONFIRMED_B',
  'CONNECTED',
  'DECLINED',
  'EXPIRED'
);

CREATE TABLE IF NOT EXISTS matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  user_b_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  status      match_status NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Expires 24h after creation if not resolved
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS matches_user_a_idx ON matches (user_a_id);
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON matches (user_b_id);
CREATE INDEX IF NOT EXISTS matches_status_idx  ON matches (status);


-- ─── RPC: update_user_location ───────────────────────────────────────────────
-- Called after H3 snapping. Accepts snapped lat/lng, stores as geometry.
-- Never accepts raw GPS — snapping must happen in application code first.

CREATE OR REPLACE FUNCTION update_user_location(
  p_user_id UUID,
  p_lat     DOUBLE PRECISION,
  p_lng     DOUBLE PRECISION
) RETURNS void AS $$
BEGIN
  UPDATE users
  SET location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;


-- ─── RPC: find_nearby_users ──────────────────────────────────────────────────
-- Discovery query for "Olhar em Volta".
-- Returns top-10 nearby users who have active listings, ordered by distance.
-- Never returns coordinates — only distances.

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
    jsonb_agg(l.payload ORDER BY (l.payload->>'number')::int) AS items,
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
