---
name: geospatial
description: "Use this skill when writing any code that involves user location: storing coordinates, querying nearby users, applying H3 snapping, or working with PostGIS geometry. Covers the full location privacy pipeline, ST_DWithin query patterns, index requirements, and common mistakes to avoid."
---

# Geospatial Queries & Location Privacy

## The Privacy Pipeline (Always Follow This Order)

```
1. Receive raw GPS from WhatsApp
      { latitude: -23.55051, longitude: -46.63382 }

2. Snap to H3 hex center at resolution 8 (~460m precision)
      import { latLngToCell, cellToLatLng } from 'h3-js';
      const cell = latLngToCell(lat, lng, 8);
      const [snappedLat, snappedLng] = cellToLatLng(cell);

3. Store as PostGIS geometry (snapped coordinates only)
      ST_SetSRID(ST_MakePoint(snappedLng, snappedLat), 4326)
      Note: MakePoint takes (longitude, latitude) — not (lat, lng).

4. Query returns distances only — never coordinates
      ST_Distance(a.location::geography, b.location::geography) AS dist_m
```

**Never skip step 2.** Never store raw GPS. Never return coordinates to any client.

---

## Storing User Location (Supabase)

```typescript
// src/services/location.ts
import { latLngToCell, cellToLatLng } from 'h3-js';
import { supabase } from '../db/client';

export async function saveUserLocation(
  userId: string,
  lat: number,
  lng: number
): Promise<Result<void, Error>> {
  const cell = latLngToCell(lat, lng, 8);
  const [snappedLat, snappedLng] = cellToLatLng(cell);

  const { error } = await supabase.rpc('update_user_location', {
    p_user_id: userId,
    p_lng: snappedLng,
    p_lat: snappedLat,
  });

  if (error) return err(new Error(error.message));
  return ok(undefined);
}
```

SQL function (in migration):
```sql
CREATE OR REPLACE FUNCTION update_user_location(
  p_user_id UUID,
  p_lng     DOUBLE PRECISION,
  p_lat     DOUBLE PRECISION
) RETURNS void AS $$
BEGIN
  UPDATE users
  SET location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Discovery Query (Olhar em Volta)

```sql
SELECT
  u.id,
  u.name,
  json_agg(l.payload->>'number' ORDER BY (l.payload->>'number')::int) AS items,
  ST_Distance(u.location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist_m
FROM users u
JOIN listings l ON l.user_id = u.id
  AND l.expires_at > NOW()
  AND l.domain = 'sticker'
WHERE
  u.id != $3
  AND ST_DWithin(
    u.location::geography,
    ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
    $4  -- radius in meters
  )
GROUP BY u.id, u.name, u.location
ORDER BY dist_m ASC
LIMIT 10;
-- $1=lat, $2=lng, $3=myUserId, $4=radiusMeters
```

Call via Supabase RPC — do not build this query dynamically in application code.

---

## Bilateral Match Query (Match Perfeito)

```sql
SELECT
  u.id,
  u.name,
  ST_Distance(u.location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist_m,
  COUNT(DISTINCT they_have.id) AS i_want_count,
  COUNT(DISTINCT i_have.id)   AS they_want_count
FROM users u
-- They have something I want
JOIN listings they_have ON they_have.user_id = u.id
  AND they_have.domain = 'sticker'
  AND they_have.expires_at > NOW()
JOIN wanted_listings my_wants ON my_wants.user_id = $3
  AND my_wants.domain = 'sticker'
  AND my_wants.payload->>'number' = they_have.payload->>'number'
-- I have something they want
JOIN wanted_listings they_want ON they_want.user_id = u.id
  AND they_want.domain = 'sticker'
JOIN listings i_have ON i_have.user_id = $3
  AND i_have.domain = 'sticker'
  AND i_have.expires_at > NOW()
  AND i_have.payload->>'number' = they_want.payload->>'number'
WHERE
  u.id != $3
  AND ST_DWithin(
    u.location::geography,
    ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
    $4
  )
GROUP BY u.id, u.name, u.location
ORDER BY (i_want_count + they_want_count) DESC, dist_m ASC
LIMIT 10;
```

---

## Required Database Index

This index must exist or the ST_DWithin query will be a full table scan:

```sql
CREATE INDEX users_location_gist ON users USING GIST (location);
```

Add in the first migration. Verify with `EXPLAIN ANALYZE` before going to production.

---

## Common Mistakes

| Mistake | Correct approach |
|---|---|
| `ST_MakePoint(lat, lng)` | Always `ST_MakePoint(lng, lat)` — longitude first |
| Querying without `::geography` cast | Use `::geography` for meter-accurate distance; omitting it gives degree-based results |
| Storing raw GPS from WhatsApp | Always H3-snap first |
| Returning `u.location` in SELECT | Never select the location column; select only `dist_m` |
| Skipping GIST index | Add in migration 001 — without it, queries degrade to O(n) |

---

## Formatting Distance for Display

```typescript
export function formatDistance(distM: number): string {
  if (distM < 1000) return `${Math.round(distM)} m`;
  return `${(distM / 1000).toFixed(1)} km`;
}
// 450 → "450 m"
// 1830 → "1.8 km"
```
