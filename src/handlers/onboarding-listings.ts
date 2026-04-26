import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { applyListingUpdate } from '../services/listings.js';
import { parseListingInput, formatListingPreview } from '../utils/listing-parser.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';

const RE_PROMPT =
  'Envie os codigos das suas figurinhas duplicadas. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

export async function handleOnboardingListings(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const pending = user.conversation_state?.context?.pending_listings;
  const buttonId = payload.buttonsResponseMessage?.selectedButtonId ?? '';
  const textInput = payload.text?.message?.trim() ?? '';

  // ── Confirmation phase: pending codes exist and user is responding ─────────
  if (pending && pending.length > 0) {
    const isConfirm = buttonId === 'confirm_listings' || textInput === '1';
    const isCorrect = buttonId === 'correct_listings' || textInput === '2';

    if (isConfirm) {
      const saveResult = await applyListingUpdate(user.id, 'sticker', { op: 'set', codes: pending });
      if (saveResult.isErr()) return saveResult;

      const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
      if (transitionResult.isErr()) return transitionResult;

      logger.info({ userId: user.id, event: 'listings_saved', count: pending.length });
      return showMainMenu(user.id, user.phone);
    }

    if (isCorrect) {
      const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, {});
      if (transitionResult.isErr()) return transitionResult;
      return sendText(user.phone, RE_PROMPT);
    }

    // Any other free text while pending → treat as a fresh parse (fall through)
    if (!textInput) {
      // Button press that wasn't confirm/correct and no text — re-prompt
      return sendText(user.phone, RE_PROMPT);
    }
  }

  // ── Parse phase: no pending (or fresh text overriding pending) ────────────
  if (!textInput) {
    return sendText(user.phone, RE_PROMPT);
  }

  const parseResult = parseListingInput(textInput);
  if (parseResult.isErr()) {
    return sendText(user.phone, parseResult.error);
  }

  const { codes } = parseResult.value;
  const formatted = formatListingPreview(codes);

  const sendResult = await sendButtons(
    user.phone,
    `Entendi estas figurinhas: ${formatted}. Esta correto?`,
    [
      { id: 'confirm_listings', label: 'Confirmar' },
      { id: 'correct_listings', label: 'Corrigir' },
    ]
  );
  if (sendResult.isErr()) return sendResult;

  logger.info({ userId: user.id, event: 'listings_pending', count: codes.length });

  return transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, { pending_listings: codes });
}
