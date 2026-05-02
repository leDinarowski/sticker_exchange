import { err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { bumpListingsExpiry, clearUserListings } from '../services/listings.js';
import { ConversationStep, User } from '../types/index.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';

const UPDATE_PROMPT =
  'Envie os codigos para substituir sua lista, ou use "adicionar" / "remover" para ajustes.';

export async function handleConfirmingInventory(
  user: User,
  payload: WebhookPayload,
  phone: string
): Promise<Result<void, Error>> {
  const buttonId = payload.buttonsResponseMessage?.selectedButtonId ?? '';
  const text = payload.text?.message?.trim() ?? '';

  const isKeep   = buttonId === 'inv_keep'   || text === '1';
  const isUpdate = buttonId === 'inv_update' || text === '2';
  const isClear  = buttonId === 'inv_clear'  || text === '3';

  if (isKeep) {
    logger.info({ userId: user.id, event: 'inventory_kept' });
    const bump = await bumpListingsExpiry(user.id, 'sticker');
    if (bump.isErr()) return bump;
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    return showMainMenu(user.id, phone);
  }

  if (isUpdate) {
    logger.info({ userId: user.id, event: 'inventory_update_requested' });
    const t = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS);
    if (t.isErr()) return t;
    return sendText(phone, UPDATE_PROMPT);
  }

  if (isClear) {
    logger.info({ userId: user.id, event: 'inventory_cleared' });
    const clear = await clearUserListings(user.id, 'sticker');
    if (clear.isErr()) return clear;
    const t = await transitionState(user.id, ConversationStep.IDLE);
    if (t.isErr()) return t;
    const send = await sendText(phone, 'Suas figurinhas foram removidas. Use o menu para adicionar novas quando quiser.');
    if (send.isErr()) return send;
    return showMainMenu(user.id, phone);
  }

  // Unknown input — re-send the nudge buttons
  return sendExpiryNudgeButtons(phone);
}

export async function sendExpiryNudge(
  target: { id: string; phone: string }
): Promise<Result<void, Error>> {
  logger.info({ userId: target.id, event: 'expiry_nudge_sent' });
  const sendResult = await sendExpiryNudgeButtons(target.phone);
  if (sendResult.isErr()) return err(sendResult.error);
  return transitionState(target.id, ConversationStep.CONFIRMING_INVENTORY);
}

async function sendExpiryNudgeButtons(phone: string): Promise<Result<void, Error>> {
  return sendButtons(phone, 'Suas figurinhas ainda estao disponiveis?', [
    { id: 'inv_keep',   label: 'Sim, ainda tenho' },
    { id: 'inv_update', label: 'Atualizar Figurinhas' },
    { id: 'inv_clear',  label: 'Nao tenho mais' },
  ]);
}
