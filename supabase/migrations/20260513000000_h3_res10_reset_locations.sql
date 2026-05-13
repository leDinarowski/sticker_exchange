-- Invalidate all H3-snapped locations after upgrading resolution 8 → 10.
--
-- Resolution 8 (~461 m cells) caused users within ~461 m to collapse to the
-- same centroid, producing dist_m = 0 in discovery queries (ADR-026).
-- Resolution 10 (~65 m cells) eliminates this for any two users > ~130 m apart.
--
-- With few active test users, setting location = NULL is acceptable.
-- Users will be re-prompted to share their location on their next message
-- (the onboarding flow already handles location IS NULL → request re-share).

SET search_path TO public, extensions;

UPDATE users SET location = NULL WHERE location IS NOT NULL;
