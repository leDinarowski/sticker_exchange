-- Returns users who have at least one active listing expiring within the next
-- 3–4 hours and are not already in CONFIRMING_INVENTORY state.
-- The 3–4h window corresponds to the 20–21h mark of a 24h listing lifetime.
-- The cron job that calls this runs hourly, so each user is nudged at most once.
CREATE OR REPLACE FUNCTION get_users_needing_expiry_nudge()
RETURNS TABLE(user_id UUID, phone TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT u.id, u.phone
  FROM users u
  JOIN listings l ON l.user_id = u.id
  WHERE l.expires_at > NOW()
    AND l.expires_at < NOW() + INTERVAL '4 hours'
    AND (u.conversation_state->>'step') IS DISTINCT FROM 'CONFIRMING_INVENTORY'
    AND u.consented_at IS NOT NULL
    AND u.phone IS NOT NULL;
$$;
