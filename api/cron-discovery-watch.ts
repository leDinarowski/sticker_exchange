import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUsersAwaitingDiscovery } from '../src/db/discovery-watch.js';
import { processDiscoveryWatch } from '../src/handlers/awaiting-discovery.js';
import { logger } from '../src/utils/logger.js';

function isWithinBRTWindow(): boolean {
  // BRT = UTC-3. Only send messages between 06:00 and 22:00 BRT.
  // UTC 09:00–01:00 next day covers that window (ignoring DST — close enough).
  const hourUTC = new Date().getUTCHours();
  return hourUTC >= 9 || hourUTC < 1;
}

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

  if (!isWithinBRTWindow()) {
    const hourUTC = new Date().getUTCHours();
    logger.info({ event: 'cron_discovery_watch_skipped', hourUTC });
    res.status(200).json({ skipped: true, hourUTC });
    return;
  }

  const usersResult = await getUsersAwaitingDiscovery();
  if (usersResult.isErr()) {
    logger.error({ event: 'cron_discovery_watch_query_failed', error: usersResult.error.message });
    res.status(500).json({ error: 'Query failed' });
    return;
  }

  const users = usersResult.value;
  logger.info({ event: 'cron_discovery_watch_started', count: users.length });

  let notified = 0;
  let exhausted = 0;
  let failed = 0;

  for (const user of users) {
    const result = await processDiscoveryWatch(user);
    if (result.isErr()) {
      logger.error({ event: 'cron_discovery_watch_user_failed', userId: user.id, error: result.error.message });
      failed++;
    } else if (result.value === 'notified') {
      notified++;
    } else if (result.value === 'exhausted') {
      exhausted++;
    }
  }

  logger.info({ event: 'cron_discovery_watch_complete', notified, exhausted, failed });
  res.status(200).json({ notified, exhausted, failed });
}
