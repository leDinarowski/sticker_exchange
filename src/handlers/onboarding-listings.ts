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

const RE_PROMPT =
  'Envie os códigos das suas figurinhas duplicadas. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

const WANTS_PROMPT =
  'Quais figurinhas você busca? Envie os códigos. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

export async function handleOnboardingListings(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const ctx = user.conversation_state?.context ?? {};
  const pending = ctx.pending_listings;
  const pendingOp = ctx.pending_op ?? 'set';
  const collectingWants = ctx.collecting_wants === true;
  const rePrompt = collectingWants ? WANTS_PROMPT : RE_PROMPT;
  const buttonId = payload.buttonsResponseMessage?.selectedButtonId ?? '';
  const textInput = payload.text?.message?.trim() ?? '';

  // ── Confirmation phase: pending codes exist and user is responding ─────────
  if (pending && pending.length > 0) {
    const isConfirm = buttonId === 'confirm_listings' || textInput === '1';
    const isCorrect = buttonId === 'correct_listings' || textInput === '2';

    if (isConfirm) {
      if (collectingWants) {
        const saveResult = await replaceWantedListings(user.id, 'sticker', pending);
        if (saveResult.isErr()) return saveResult;

        logger.info({ userId: user.id, event: 'wants_saved', count: pending.length });
        return runBilateralQuery(user, user.phone);
      }

      const saveResult = await applyListingUpdate(user.id, 'sticker', { op: pendingOp, codes: pending });
      if (saveResult.isErr()) return saveResult;

      // Reset expiry for all remaining listings so any differential update also extends the window
      if (pendingOp !== 'set') {
        const bumpResult = await bumpListingsExpiry(user.id, 'sticker');
        if (bumpResult.isErr()) return bumpResult;
      }

      const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
      if (transitionResult.isErr()) return transitionResult;

      logger.info({ userId: user.id, event: 'listings_saved', count: pending.length, op: pendingOp });
      return showMainMenu(user.id, user.phone);
    }

    if (isCorrect) {
      const newCtx = collectingWants ? { collecting_wants: true } : {};
      const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, newCtx);
      if (transitionResult.isErr()) return transitionResult;
      return sendText(user.phone, rePrompt);
    }

    // Any other free text while pending → treat as a fresh parse (fall through)
    if (!textInput) {
      // Button press that wasn't confirm/correct and no text — re-prompt
      return sendText(user.phone, rePrompt);
    }
  }

  // ── Parse phase: no pending (or fresh text overriding pending) ────────────
  if (!textInput) {
    return sendText(user.phone, rePrompt);
  }

  const parseResult = parseListingInput(textInput);
  if (parseResult.isErr()) {
    return sendText(user.phone, parseResult.error);
  }

  const { op, codes } = parseResult.value;
  const formatted = formatListingPreview(codes);

  let echoText: string;
  if (collectingWants) {
    echoText = `Entendi que você busca: ${formatted}. Está correto?`;
  } else if (op === 'add') {
    echoText = `Adicionar estas figurinhas: ${formatted}. Está correto?`;
  } else if (op === 'remove') {
    echoText = `Remover estas figurinhas: ${formatted}. Está correto?`;
  } else {
    echoText = `Entendi estas figurinhas: ${formatted}. Está correto?`;
  }

  const sendResult = await sendButtons(
    user.phone,
    echoText,
    [
      { id: 'confirm_listings', label: 'Confirmar' },
      { id: 'correct_listings', label: 'Corrigir' },
    ]
  );
  if (sendResult.isErr()) return sendResult;

  logger.info({ userId: user.id, event: collectingWants ? 'wants_pending' : 'listings_pending', count: codes.length, op });

  const pendingCtx = collectingWants
    ? { collecting_wants: true, pending_listings: codes }
    : { pending_listings: codes, pending_op: op };

  return transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, pendingCtx);
}
