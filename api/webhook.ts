import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger';

/**
 * POST /api/webhook
 * Receives all incoming WhatsApp events from Z-API.
 * This is the single entry point for the entire bot.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Acknowledge immediately — Z-API expects a fast 200 response
  res.status(200).json({ ok: true });

  logger.info({ event: 'webhook_received', method: req.method });

  // TODO: validate webhook signature, parse payload, route to handler
}
