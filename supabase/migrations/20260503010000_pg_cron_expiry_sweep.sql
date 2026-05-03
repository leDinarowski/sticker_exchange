-- Phase 8: enable pg_cron and schedule daily hard-delete of expired listings.
--
-- PRE-REQUISITE (manual step before running this migration):
--   Enable pg_cron in Supabase dashboard → Database → Extensions → pg_cron.
--   Supabase requires this toggle before CREATE EXTENSION succeeds.
--
-- Grace period: 1 hour after expires_at before hard-delete.
-- Listings expire passively at 24h (exits queries). Actual row deletion
-- happens at 02:00 UTC the following day — safe for any lingering sessions.

CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule first so re-running the migration is idempotent.
SELECT cron.unschedule('hard-delete-expired-listings')
 WHERE EXISTS (
   SELECT 1 FROM cron.job WHERE jobname = 'hard-delete-expired-listings'
 );

SELECT cron.schedule(
  'hard-delete-expired-listings',
  '0 2 * * *',
  $$DELETE FROM listings WHERE expires_at < NOW() - INTERVAL '1 hour';$$
);
