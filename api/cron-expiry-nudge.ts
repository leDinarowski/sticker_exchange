import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUsersNeedingNudge } from '../src/db/listings.js';
import { sendExpiryNudge } from '../src/handlers/confirming-inventory.js';
import { logger } from '../src/utils/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env['CRON_SECRET'];
  const authHeader = req.headers['authorization'];
  if (!secret || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const targetsResult = await getUsersNeedingNudge();
  if (targetsResult.isErr()) {
    logger.error({ event: 'cron_nudge_query_failed', error: targetsResult.error.message });
    res.status(500).json({ error: 'Query failed' });
    return;
  }

  const targets = targetsResult.value;
  logger.info({ event: 'cron_nudge_started', count: targets.length });

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await sendExpiryNudge({ id: target.user_id, phone: target.phone });
    if (result.isErr()) {
      logger.error({ event: 'cron_nudge_send_failed', userId: target.user_id, error: result.error.message });
      failed++;
    } else {
      sent++;
    }
  }

  logger.info({ event: 'cron_nudge_complete', sent, failed });
  res.status(200).json({ sent, failed });
}
