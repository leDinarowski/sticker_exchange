import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../src/db/client.js';
import { logger } from '../src/utils/logger.js';

/**
 * GET /api/health
 * Confirms that Supabase is reachable from Vercel.
 * Use this as the Phase 0 smoke test.
 */
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);

    if (error) {
      logger.error({ event: 'health_check_failed', error: error.message });
      res.status(503).json({ ok: false, error: error.message });
      return;
    }

    logger.info({ event: 'health_check_ok' });
    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ event: 'health_check_exception', error: message });
    res.status(503).json({ ok: false, error: message });
  }
}
