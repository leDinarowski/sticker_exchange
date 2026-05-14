import { err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, findUserById } from '../db/users.js';
import {
  createGroup,
  sendText,
  sendButtons,
} from '../services/zapi.js';
import {
  getMatchById,
  updateMatchStatus,
  getPendingMatchesForUserA,
} from '../db/matches.js';
import { ConversationStep, MatchStatus, User } from '../types/index.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';
import { findNearestMeetingPlace } from '../db/meeting-places.js';
import { formatMeetingPlaceMessage } from '../utils/format-meeting-place.js';
import { resolveButtonId } from '../webhook/utils.js';

// ─── Entry point ────────────────────────────────────────────────────────────

export async function handleAwaitingMatchResponse(
  user: User,
  payload: WebhookPayload,
  phone: string
): Promise<Result<void, Error>> {
  const ctx = user.conversation_state?.context ?? {};

  if (ctx.pending_match_id) {
    return handleMatchRespondent(user, payload, phone, ctx.pending_match_id, ctx.pending_target_name ?? 'Alguém');
  }

  const text = payload.text?.message?.trim().toLowerCase() ?? '';
  if (text === 'cancelar') {
    return handleMatchInitiatorCancel(user, phone);
  }

  return handleMatchInitiator(user, phone);
}

// ─── User B: deciding whether to accept or decline ──────────────────────────

async function handleMatchRespondent(
  user: User,
  payload: WebhookPayload,
  phone: string,
  matchId: string,
  initiatorName: string
): Promise<Result<void, Error>> {
  const action = resolveRespondentAction(payload, matchId);

  if (action === 'unknown') {
    return sendButtons(
      phone,
      `${initiatorName} quer trocar figurinhas com você. Aceita?`,
      [
        { id: `match_accept_${matchId}`, label: 'Sim' },
        { id: `match_decline_${matchId}`, label: 'Não' },
      ]
    );
  }

  const matchResult = await getMatchById(matchId);
  if (matchResult.isErr()) return err(matchResult.error);

  const match = matchResult.value;
  if (!match) {
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    return showMainMenu(user.id, phone);
  }

  if (new Date(match.expires_at) < new Date()) {
    logger.info({ userId: user.id, matchId, event: 'match_expired_on_response' });
    const upd = await updateMatchStatus(matchId, MatchStatus.EXPIRED);
    if (upd.isErr()) return upd;
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    const send = await sendText(phone, 'Este pedido expirou.');
    if (send.isErr()) return send;
    return showMainMenu(user.id, phone);
  }

  if (action === 'accept') {
    return processAccept(user, phone, match.id, match.user_a_id);
  }

  return processDecline(user, phone, match.id, match.user_a_id, initiatorName);
}

function resolveRespondentAction(
  payload: WebhookPayload,
  matchId: string
): 'accept' | 'decline' | 'unknown' {
  const buttonId = resolveButtonId(payload, {
    Sim: `match_accept_${matchId}`,
    Não: `match_decline_${matchId}`,
  });
  if (buttonId === `match_accept_${matchId}`) return 'accept';
  if (buttonId === `match_decline_${matchId}`) return 'decline';

  const text = payload.text?.message?.trim();
  if (text === '1') return 'accept';
  if (text === '2') return 'decline';

  return 'unknown';
}

async function processAccept(
  userB: User,
  phoneB: string,
  matchId: string,
  userAId: string
): Promise<Result<void, Error>> {
  logger.info({ userId: userB.id, matchId, event: 'match_accepted' });

  const upd1 = await updateMatchStatus(matchId, MatchStatus.CONFIRMED_B);
  if (upd1.isErr()) return upd1;

  const userAResult = await findUserById(userAId);
  if (userAResult.isErr()) return err(userAResult.error);
  const userA = userAResult.value;

  if (!userA) {
    const t = await transitionState(userB.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    return showMainMenu(userB.id, phoneB);
  }

  const groupResult = await createGroup(`Troca: ${userA.name ?? 'A'} e ${userB.name ?? 'B'}`, [userA.phone, userB.phone]);
  if (groupResult.isErr()) return err(groupResult.error);
  const groupPhone = groupResult.value;

  const welcome = await sendText(groupPhone, 'Combinado! Combinem horário e local aqui no grupo. Boa troca!');
  if (welcome.isErr()) return welcome;

  // Meeting place suggestion — non-fatal: failure never blocks the connection flow.
  const placeResult = await findNearestMeetingPlace(userA.id, userB.id);
  if (placeResult.isErr()) {
    logger.warn({ event: 'meeting_place_query_failed', matchId, error: placeResult.error.message });
  } else if (placeResult.value) {
    const suggest = await sendText(groupPhone, formatMeetingPlaceMessage(placeResult.value));
    if (suggest.isErr()) {
      logger.warn({ event: 'meeting_place_send_failed', matchId, error: suggest.error.message });
    }
  } else {
    logger.info({ event: 'meeting_place_not_found', matchId });
  }

  const upd2 = await updateMatchStatus(matchId, MatchStatus.CONNECTED);
  if (upd2.isErr()) return upd2;

  // Notify and return User A to IDLE
  const notifyA = await sendText(userA.phone, `${userB.name ?? 'Alguém'} aceitou. O grupo foi criado no WhatsApp.`);
  if (notifyA.isErr()) return notifyA;
  const tA = await transitionState(userA.id, ConversationStep.IDLE);
  if (tA.isErr()) return tA;
  const menuA = await showMainMenu(userA.id, userA.phone);
  if (menuA.isErr()) return menuA;

  // Return User B to IDLE (group welcome already confirmed the match; no redundant private message)
  const tB = await transitionState(userB.id, ConversationStep.IDLE);
  if (tB.isErr()) return tB;
  return showMainMenu(userB.id, phoneB);
}

async function processDecline(
  userB: User,
  phoneB: string,
  matchId: string,
  userAId: string,
  _initiatorName: string
): Promise<Result<void, Error>> {
  logger.info({ userId: userB.id, matchId, event: 'match_declined' });

  const upd = await updateMatchStatus(matchId, MatchStatus.DECLINED);
  if (upd.isErr()) return upd;

  const userAResult = await findUserById(userAId);
  if (userAResult.isErr()) return err(userAResult.error);
  const userA = userAResult.value;

  if (userA) {
    const notifyA = await sendText(
      userA.phone,
      `${userB.name ?? 'Alguém'} não aceitou a troca desta vez.`
    );
    if (notifyA.isErr()) return notifyA;
    const tA = await transitionState(userA.id, ConversationStep.IDLE);
    if (tA.isErr()) return tA;
    const menuA = await showMainMenu(userA.id, userA.phone);
    if (menuA.isErr()) return menuA;
  }

  const closureB = await sendText(phoneB, 'Tudo bem. Se quiser encontrar outras pessoas, use o menu.');
  if (closureB.isErr()) return closureB;
  const tB = await transitionState(userB.id, ConversationStep.IDLE);
  if (tB.isErr()) return tB;
  return showMainMenu(userB.id, phoneB);
}

// ─── User A: waiting for respondent ─────────────────────────────────────────

async function handleMatchInitiatorCancel(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  logger.info({ userId: user.id, event: 'match_initiator_cancelled' });

  const pendingResult = await getPendingMatchesForUserA(user.id);
  if (pendingResult.isErr()) return err(pendingResult.error);

  for (const m of pendingResult.value) {
    const upd = await updateMatchStatus(m.id, MatchStatus.EXPIRED);
    if (upd.isErr()) return upd;
  }

  const t = await transitionState(user.id, ConversationStep.IDLE);
  if (t.isErr()) return t;
  const send = await sendText(phone, 'Pedido cancelado. Use o menu para tentar novamente.');
  if (send.isErr()) return send;
  return showMainMenu(user.id, phone);
}

async function handleMatchInitiator(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const pendingResult = await getPendingMatchesForUserA(user.id);
  if (pendingResult.isErr()) return err(pendingResult.error);

  const pending = pendingResult.value;

  if (pending.length === 0) {
    // All matches resolved — transition to IDLE
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    return showMainMenu(user.id, phone);
  }

  const now = new Date();
  const expired = pending.filter(m => new Date(m.expires_at) < now);
  const active = pending.filter(m => new Date(m.expires_at) >= now);

  for (const m of expired) {
    const upd = await updateMatchStatus(m.id, MatchStatus.EXPIRED);
    if (upd.isErr()) return upd;
  }

  if (active.length > 0) {
    return sendText(phone, 'Ainda aguardando resposta... Responda "cancelar" para desistir.');
  }

  // All expired — return to IDLE
  logger.info({ userId: user.id, event: 'match_all_expired_initiator' });
  const t = await transitionState(user.id, ConversationStep.IDLE);
  if (t.isErr()) return t;
  const send = await sendText(phone, 'Seu pedido expirou. Use o menu para tentar novamente.');
  if (send.isErr()) return send;
  return showMainMenu(user.id, phone);
}
