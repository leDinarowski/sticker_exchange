import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../src/db/client.js';
import { checkZApiConnectivity } from '../src/services/zapi.js';
import { logger } from '../src/utils/logger.js';

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  let supabaseStatus: 'ok' | 'error' = 'ok';
  let zapiStatus: 'ok' | 'error' = 'ok';

  // Both checks run independently — never short-circuit so the response always
  // reports the status of both components even when one has failed.
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      logger.error({ event: 'health_supabase_failed', error: error.message });
      supabaseStatus = 'error';
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    logger.error({ event: 'health_supabase_exception', error: message });
    supabaseStatus = 'error';
  }

  const zapiResult = await checkZApiConnectivity();
  if (zapiResult.isErr()) {
    logger.error({ event: 'health_zapi_failed', error: zapiResult.error.message });
    zapiStatus = 'error';
  }

  const ok = supabaseStatus === 'ok' && zapiStatus === 'ok';
  logger.info({
    event: ok ? 'health_check_ok' : 'health_check_degraded',
    supabase: supabaseStatus,
    zapi: zapiStatus,
  });

  res.status(ok ? 200 : 503).json({ ok, supabase: supabaseStatus, zapi: zapiStatus });
}
