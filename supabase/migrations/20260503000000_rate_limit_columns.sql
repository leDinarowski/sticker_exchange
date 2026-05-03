-- Phase 8: per-user rate limit window columns + atomic RPC.
-- Prevents message loops: max 10 messages per user per 60-second window.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rate_window_start  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rate_window_count  INT NOT NULL DEFAULT 0;

-- check_rate_limit(p_user_id)
-- Atomically checks and increments the per-user sliding window.
-- Returns TRUE  → request is allowed (counter incremented).
-- Returns FALSE → rate limit exceeded; caller should silently drop the message.
--
-- FOR UPDATE on the SELECT serialises concurrent webhook invocations for the
-- same user without needing an application-level lock or Redis.
CREATE OR REPLACE FUNCTION check_rate_limit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_count INT;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
  SELECT rate_window_start, rate_window_count
    INTO v_start, v_count
    FROM users
   WHERE id = p_user_id
     FOR UPDATE;

  -- New window (no prior window, or window expired): reset and allow.
  IF v_start IS NULL OR v_start < v_now - INTERVAL '1 minute' THEN
    UPDATE users
       SET rate_window_start = v_now,
           rate_window_count = 1
     WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  -- Within window but limit reached: deny without incrementing.
  IF v_count >= 10 THEN
    RETURN FALSE;
  END IF;

  -- Within window and under limit: increment and allow.
  UPDATE users
     SET rate_window_count = rate_window_count + 1
   WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;
