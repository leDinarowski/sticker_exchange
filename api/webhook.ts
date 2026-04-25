import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger.js';
import { webhookPayloadSchema } from '../src/webhook/schema.js';
import { findUser, UserIdentifier } from '../src/db/users.js';
import { route } from '../src/webhook/router.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const zapiToken = req.headers['z-api-token'];
  if (zapiToken !== process.env['ZAPI_TOKEN']) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.status(200).json({ ok: true });

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ event: 'webhook_parse_failed', issues: parsed.error.issues.length });
    return;
  }

  const payload = parsed.data;

  const identifier: UserIdentifier = {
    phone: payload.phone,
  };

  const userResult = await findUser(identifier);
  if (userResult.isErr()) {
    logger.error({ event: 'find_user_failed', error: userResult.error.message });
    return;
  }

  const user = userResult.value;

  const routeResult = await route(user, identifier, payload);
  if (routeResult.isErr()) {
    logger.error({ userId: user?.id ?? 'unknown', event: 'route_error', error: routeResult.error.message });
  }
}
