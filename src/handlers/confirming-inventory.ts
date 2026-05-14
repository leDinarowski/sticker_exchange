import { err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { bumpListingsExpiry, clearUserListings } from '../services/listings.js';
import { getUserActiveListingsCount } from '../db/listings.js';
import { ConversationStep, User } from '../types/index.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';
import { resolveButtonId } from '../webhook/utils.js';

const UPDATE_PROMPT =
  'Envie os códigos para substituir sua lista, ou use "adicionar" / "remover" para ajustes.';

const BUTTON_LABELS = {
  'Sim, ainda tenho': 'inv_keep',
  'Atualizar Figurinhas': 'inv_update',
  'Não tenho mais': 'inv_clear',
  Confirmar: 'clear_confirm',
  Cancelar: 'clear_cancel',
};

export async function handleConfirmingInventory(
  user: User,
  payload: WebhookPayload,
  phone: string
): Promise<Result<void, Error>> {
  const buttonId = resolveButtonId(payload, BUTTON_LABELS);
  const text = payload.text?.message?.trim() ?? '';
  const ctx = user.conversation_state?.context ?? {};

  // ── Confirmation phase: user tapped "Não tenho mais" and is confirming ───────
  if (ctx.pending_clear === true) {
    const isConfirm = buttonId === 'clear_confirm' || text === '1';
    const isCancel  = buttonId === 'clear_cancel'  || text === '2';

    if (isConfirm) {
      logger.info({ userId: user.id, event: 'inventory_cleared' });
      const clear = await clearUserListings(user.id, 'sticker');
      if (clear.isErr()) return clear;
      const t = await transitionState(user.id, ConversationStep.IDLE);
      if (t.isErr()) return t;
      const send = await sendText(phone, 'Suas figurinhas foram removidas. Use o menu para adicionar novas quando quiser.');
      if (send.isErr()) return send;
      return showMainMenu(user.id, phone);
    }

    if (isCancel) {
      logger.info({ userId: user.id, event: 'inventory_clear_cancelled' });
      const t = await transitionState(user.id, ConversationStep.IDLE);
      if (t.isErr()) return t;
      const send = await sendText(phone, 'Suas figurinhas foram mantidas.');
      if (send.isErr()) return send;
      return showMainMenu(user.id, phone);
    }

    // Re-prompt confirmation
    return sendClearConfirmButtons(phone);
  }

  // ── Normal nudge response ─────────────────────────────────────────────────────
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
    const countResult = await getUserActiveListingsCount(user.id, 'sticker');
    const count = countResult.isOk() ? countResult.value : 0;
    const intro = count > 0
      ? `Você tem ${count} figurinha${count === 1 ? '' : 's'} cadastrada${count === 1 ? '' : 's'}. `
      : 'Você não tem figurinhas cadastradas ainda. ';
    const t = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS);
    if (t.isErr()) return t;
    return sendText(phone, intro + UPDATE_PROMPT);
  }

  if (isClear) {
    // Store pending_clear flag and ask for confirmation before wiping
    const t = await transitionState(user.id, ConversationStep.CONFIRMING_INVENTORY, { pending_clear: true });
    if (t.isErr()) return t;
    return sendClearConfirmButtons(phone);
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
  return sendButtons(phone, 'Suas figurinhas ainda estão disponíveis?', [
    { id: 'inv_keep',   label: 'Sim, ainda tenho' },
    { id: 'inv_update', label: 'Atualizar Figurinhas' },
    { id: 'inv_clear',  label: 'Não tenho mais' },
  ]);
}

async function sendClearConfirmButtons(phone: string): Promise<Result<void, Error>> {
  return sendButtons(phone, 'Tem certeza? Isso vai remover todas as suas figurinhas.', [
    { id: 'clear_confirm', label: 'Confirmar' },
    { id: 'clear_cancel',  label: 'Cancelar' },
  ]);
}
