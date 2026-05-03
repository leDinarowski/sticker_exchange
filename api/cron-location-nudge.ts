import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUsersForLocationNudge } from '../src/db/listings.js';
import { markLocationNudgeSent } from '../src/db/users.js';
import { sendText } from '../src/services/zapi.js';
import { logger } from '../src/utils/logger.js';

const LOCATION_NUDGE_MSG =
  'Sua localizacao ainda esta correta? Use o menu para atualizar.';

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

  const targetsResult = await getUsersForLocationNudge();
  if (targetsResult.isErr()) {
    logger.error({ event: 'cron_location_nudge_query_failed', error: targetsResult.error.message });
    res.status(500).json({ error: 'Query failed' });
    return;
  }

  const targets = targetsResult.value;
  logger.info({ event: 'cron_location_nudge_started', count: targets.length });

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const sendResult = await sendText(target.phone, LOCATION_NUDGE_MSG);
    if (sendResult.isErr()) {
      logger.error({ event: 'cron_location_nudge_send_failed', userId: target.user_id, error: sendResult.error.message });
      failed++;
      continue;
    }

    sent++;

    // Reset the 7-day clock so this user is not nudged again until 7 days pass.
    const markResult = await markLocationNudgeSent(target.user_id);
    if (markResult.isErr()) {
      logger.error({ event: 'cron_location_nudge_mark_failed', userId: target.user_id, error: markResult.error.message });
      // Non-fatal: nudge was delivered, the clock reset failure doesn't affect the count.
    }
  }

  logger.info({ event: 'cron_location_nudge_complete', sent, failed });
  res.status(200).json({ sent, failed });
}
