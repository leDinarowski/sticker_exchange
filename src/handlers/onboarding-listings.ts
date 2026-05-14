import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { applyListingUpdate, bumpListingsExpiry } from '../services/listings.js';
import { replaceWantedListings } from '../db/bilateral.js';
import { runBilateralQuery } from './bilateral.js';
import { parseListingInput, formatListingPreview } from '../utils/listing-parser.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';
import { resolveButtonId } from '../webhook/utils.js';

const RE_PROMPT =
  'Envie os códigos das suas figurinhas duplicadas. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

const WANTS_PROMPT =
  'Quais figurinhas você busca? Envie os códigos. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

const BUTTON_LABELS = {
  Confirmar: 'confirm_listings',
  Corrigir: 'correct_listings',
};

export async function handleOnboardingListings(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const ctx = user.conversation_state?.context ?? {};
  const accumulated = ctx.accumulated_codes ?? [];
  const pendingOp = ctx.pending_op ?? 'set';
  const collectingWants = ctx.collecting_wants === true;
  const rePrompt = collectingWants ? WANTS_PROMPT : RE_PROMPT;
  const buttonId = resolveButtonId(payload, BUTTON_LABELS);
  const textInput = payload.text?.message?.trim() ?? '';

  // ── [Confirmar]: save accumulated list ────────────────────────────────────
  if (buttonId === 'confirm_listings' || textInput === '1') {
    if (accumulated.length === 0) {
      return sendText(user.phone, rePrompt);
    }

    if (collectingWants) {
      const saveResult = await replaceWantedListings(user.id, 'sticker', accumulated);
      if (saveResult.isErr()) return saveResult;

      logger.info({ userId: user.id, event: 'wants_saved', count: accumulated.length });
      return runBilateralQuery(user, user.phone);
    }

    const saveResult = await applyListingUpdate(user.id, 'sticker', { op: pendingOp, codes: accumulated });
    if (saveResult.isErr()) return saveResult;

    // Reset expiry for all remaining listings so any differential update also extends the window
    if (pendingOp !== 'set') {
      const bumpResult = await bumpListingsExpiry(user.id, 'sticker');
      if (bumpResult.isErr()) return bumpResult;
    }

    const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'listings_saved', count: accumulated.length, op: pendingOp });
    return showMainMenu(user.id, user.phone);
  }

  // ── [Corrigir]: clear accumulated and re-prompt ───────────────────────────
  if (buttonId === 'correct_listings' || textInput === '2') {
    const newCtx = collectingWants ? { collecting_wants: true } : {};
    const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, newCtx);
    if (transitionResult.isErr()) return transitionResult;
    return sendText(user.phone, rePrompt);
  }

  // ── Text input: parse and accumulate ─────────────────────────────────────
  if (!textInput) {
    return sendText(user.phone, rePrompt);
  }

  const parseResult = parseListingInput(textInput);
  if (parseResult.isErr()) {
    return sendText(user.phone, parseResult.error);
  }

  const { op, codes } = parseResult.value;
  const newAccumulated = [...new Set([...accumulated, ...codes])];
  // Lock the operation from the first message; subsequent messages only contribute codes
  const effectiveOp = accumulated.length > 0 ? pendingOp : op;
  const formatted = formatListingPreview(newAccumulated);

  let echoText: string;
  if (collectingWants) {
    echoText = `Você busca: ${formatted}.\n\nContinue digitando para adicionar mais ou confirme:`;
  } else if (effectiveOp === 'add') {
    echoText = `Adicionar: ${formatted}.\n\nContinue digitando para adicionar mais ou confirme:`;
  } else if (effectiveOp === 'remove') {
    echoText = `Remover: ${formatted}.\n\nContinue digitando para adicionar mais ou confirme:`;
  } else {
    echoText = `Lista atual: ${formatted}.\n\nContinue digitando para adicionar mais ou confirme:`;
  }

  const sendResult = await sendButtons(
    user.phone,
    echoText,
    [
      { id: 'confirm_listings',  label: 'Confirmar' },
      { id: 'correct_listings',  label: 'Corrigir' },
    ]
  );
  if (sendResult.isErr()) return sendResult;

  logger.info({
    userId: user.id,
    event: collectingWants ? 'wants_accumulated' : 'listings_accumulated',
    total: newAccumulated.length,
    added: codes.length,
    op: effectiveOp,
  });

  const newCtx = collectingWants
    ? { collecting_wants: true, accumulated_codes: newAccumulated }
    : { accumulated_codes: newAccumulated, pending_op: effectiveOp };

  return transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, newCtx);
}
