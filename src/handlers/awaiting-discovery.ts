import { ok, err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { findNearbyUsers } from '../db/discovery.js';
import { findBilateralMatches } from '../db/bilateral.js';
import { ConversationStep, User, DiscoveryUser } from '../types/index.js';
import { sendText } from '../services/zapi.js';
import { formatDiscoveryList, formatBilateralList } from '../utils/format-discovery.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';

export async function handleAwaitingDiscovery(
  user: User,
  payload: WebhookPayload,
  phone: string
): Promise<Result<void, Error>> {
  const ctx = user.conversation_state?.context ?? {};
  const attempts = ctx.watch_attempts ?? 0;
  const text = payload.text?.message?.trim().toLowerCase() ?? '';

  if (text === 'cancelar') {
    logger.info({ userId: user.id, event: 'discovery_watch_cancelled' });
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    const send = await sendText(phone, 'Alerta cancelado.');
    if (send.isErr()) return send;
    return showMainMenu(user.id, phone);
  }

  return sendText(
    phone,
    `Monitorando figurinhas para você. ${attempts} de 6 verificações feitas. Responda "cancelar" para parar.`
  );
}

export async function processDiscoveryWatch(
  user: DiscoveryUser
): Promise<Result<'notified' | 'exhausted' | 'pending', Error>> {
  const ctx = user.conversation_state?.context ?? {};
  const watchMode = ctx.watch_mode ?? 'discovery';
  const attempts = ctx.watch_attempts ?? 0;
  const newAttempts = attempts + 1;

  logger.info({ userId: user.id, event: 'discovery_watch_attempt', attempt: newAttempts, mode: watchMode });

  const searchResult = watchMode === 'discovery'
    ? await findNearbyUsers(user.id)
    : await findBilateralMatches(user.id);

  if (searchResult.isErr()) return err(searchResult.error);

  const entries = searchResult.value;

  if (entries.length > 0) {
    const intro = watchMode === 'discovery'
      ? 'Boa notícia! Encontramos pessoas com figurinhas perto de você:'
      : 'Boa notícia! Encontramos um match perfeito para você:';

    const introSend = await sendText(user.phone, intro);
    if (introSend.isErr()) return err(introSend.error);

    const listMsg = watchMode === 'discovery'
      ? formatDiscoveryList(entries)
      : formatBilateralList(entries);

    const listSend = await sendText(user.phone, listMsg);
    if (listSend.isErr()) return err(listSend.error);

    const t = await transitionState(user.id, ConversationStep.BROWSING, {
      mode: watchMode,
      discovery_list: entries,
    });
    if (t.isErr()) return err(t.error);

    logger.info({ userId: user.id, event: 'discovery_watch_notified', mode: watchMode });
    return ok('notified');
  }

  if (newAttempts >= 6) {
    const send = await sendText(
      user.phone,
      'Não encontramos ninguém nas últimas horas. Quando quiser tentar de novo, use o menu.'
    );
    if (send.isErr()) return err(send.error);

    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return err(t.error);

    const menu = await showMainMenu(user.id, user.phone);
    if (menu.isErr()) return err(menu.error);

    logger.info({ userId: user.id, event: 'discovery_watch_exhausted' });
    return ok('exhausted');
  }

  const t = await transitionState(user.id, ConversationStep.AWAITING_DISCOVERY, {
    ...ctx,
    watch_attempts: newAttempts,
  });
  if (t.isErr()) return err(t.error);

  return ok('pending');
}
