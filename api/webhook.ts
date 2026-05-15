import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger.js';
import { webhookPayloadSchema } from '../src/webhook/schema.js';
import {
  findUser,
  checkRateLimit,
  transitionState,
  UserIdentifier,
} from '../src/db/users.js';
import { route } from '../src/webhook/router.js';
import { sendText } from '../src/services/zapi.js';
import { ConversationStep } from '../src/types/index.js';

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

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({
      event: 'webhook_parse_failed',
      issues: parsed.error.issues.length,
      paths: parsed.error.issues.map((i) => i.path.join('.')),
      rawBody: JSON.stringify(req.body).slice(0, 500),
    });
    res.status(200).json({ ok: true });
    return;
  }

  const payload = parsed.data;

  // TODO(diagnose-group-loop): remover após confirmar que webhook_group_filtered
  // está disparando para mensagens dentro de grupos criados pelo bot.
  logger.info({
    event: 'webhook_payload_diagnose_group',
    keys: Object.keys(payload),
    isGroup: payload.isGroup,
    hasParticipantPhone: !!payload.participantPhone,
    hasChatName: !!payload.chatName,
    phonePrefix: payload.phone.slice(0, 6),
    phoneEnd: payload.phone.slice(-6),
    rawBody: JSON.stringify(req.body).slice(0, 800),
  });

  const groupSignal = payload.phone.includes('@g.us')
    ? 'phone_suffix'
    : payload.isGroup === true
      ? 'is_group_flag'
      : payload.participantPhone
        ? 'has_participant_phone'
        : null;

  if (groupSignal) {
    logger.info({
      event: 'webhook_group_filtered',
      signal: groupSignal,
      phonePrefix: payload.phone.slice(0, 6),
      hasParticipant: !!payload.participantPhone,
      hasChatName: !!payload.chatName,
    });
    res.status(200).json({ ok: true });
    return;
  }

  const identifier: UserIdentifier = {
    phone: payload.phone,
  };

  const userResult = await findUser(identifier);
  if (userResult.isErr()) {
    logger.error({ event: 'find_user_failed', error: userResult.error.message });
    res.status(200).json({ ok: true });
    return;
  }

  const user = userResult.value;

  // Rate limiting: skip fromMe messages and new users (no DB row yet).
  // Fails open: if the RPC errors, the message is allowed through to avoid
  // blocking legitimate traffic due to a transient DB issue.
  if (!payload.fromMe && user) {
    const rateLimitResult = await checkRateLimit(user.id);
    if (rateLimitResult.isErr()) {
      logger.warn({ userId: user.id, event: 'rate_limit_rpc_failed', error: rateLimitResult.error.message });
    } else if (!rateLimitResult.value) {
      logger.warn({ userId: user.id, event: 'rate_limit_exceeded' });
      res.status(200).json({ ok: true });
      return;
    }
  }

  // Error boundary: catch both Result errors and thrown exceptions.
  // sendFallback swallows its own errors — must return 200 to Z-API regardless.
  try {
    const routeResult = await route(user, identifier, payload);
    if (routeResult.isErr()) {
      logger.error({ userId: user?.id ?? 'unknown', event: 'route_error', error: routeResult.error.message });
      await sendFallback(user?.id ?? null, payload.phone);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error';
    logger.error({ userId: user?.id ?? 'unknown', event: 'route_exception', error: message });
    await sendFallback(user?.id ?? null, payload.phone);
  }

  res.status(200).json({ ok: true });
}

async function sendFallback(userId: string | null, phone: string): Promise<void> {
  try {
    await sendText(phone, 'Algo deu errado. Use o menu para continuar.');
    if (userId) {
      await transitionState(userId, ConversationStep.IDLE);
    }
  } catch {
    // Swallow — we must return 200 to Z-API regardless of fallback outcome.
  }
}
