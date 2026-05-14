import { ok, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, updateUserName } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { WebhookPayload } from '../webhook/schema.js';

const MAX_RETRIES = 3;
const RE_PROMPT = 'Envie seu nome (entre 2 e 50 caracteres).';

export async function handleOnboardingName(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const ctx = user.conversation_state?.context ?? {};
  const pendingName = ctx.pending_name;
  const buttonId = payload.buttonsResponseMessage?.selectedButtonId ?? '';
  const textInput = payload.text?.message?.trim() ?? '';

  // ── Confirmation phase ────────────────────────────────────────────────────
  if (pendingName) {
    const isConfirm = buttonId === 'confirm_name' || textInput === '1';
    const isAlter   = buttonId === 'alter_name'   || textInput === '2';

    if (isConfirm) {
      const nameResult = await updateUserName(user.id, pendingName);
      if (nameResult.isErr()) return nameResult;

      const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_TERMS, {});
      if (transitionResult.isErr()) return transitionResult;

      logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_TERMS });

      return sendButtons(
        user.phone,
        'Seus dados serão usados para encontrar pessoas próximas para troca. Aceita?',
        [
          { id: 'terms_accept', label: 'Aceito' },
          { id: 'terms_refuse', label: 'Recuso' },
        ]
      );
    }

    if (isAlter) {
      const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_NAME, {});
      if (transitionResult.isErr()) return transitionResult;
      return sendText(user.phone, RE_PROMPT);
    }

    // Unrecognized input while pending — re-prompt (no state change)
    return sendText(user.phone, RE_PROMPT);
  }

  // ── Parse phase ───────────────────────────────────────────────────────────
  const retryCount = ctx.retry_count ?? 0;

  if (textInput.length < 2 || textInput.length > 50) {
    const nextRetry = retryCount + 1;
    const message =
      nextRetry >= MAX_RETRIES
        ? 'Por favor, envie seu nome (entre 2 e 50 caracteres).'
        : 'Envie apenas seu primeiro nome, ex: Maria.';

    const transitionResult = await transitionState(
      user.id,
      ConversationStep.ONBOARDING_NAME,
      { retry_count: nextRetry >= MAX_RETRIES ? 0 : nextRetry }
    );
    if (transitionResult.isErr()) return transitionResult;

    const sendResult = await sendText(user.phone, message);
    if (sendResult.isErr()) return sendResult;

    logger.info({ userId: user.id, event: 'onboarding_name_retry', attempt: nextRetry });
    return ok(undefined);
  }

  // Valid name — echo-back
  const sendResult = await sendButtons(
    user.phone,
    `Nome: ${textInput}\n\nConfirma?`,
    [
      { id: 'confirm_name', label: 'Confirmar' },
      { id: 'alter_name',   label: 'Alterar' },
    ]
  );
  if (sendResult.isErr()) return sendResult;

  logger.info({ userId: user.id, event: 'onboarding_name_pending', name: textInput });

  return transitionState(user.id, ConversationStep.ONBOARDING_NAME, { pending_name: textInput });
}
