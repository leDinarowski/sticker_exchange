import { ok, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, updateUserName } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { WebhookPayload } from '../webhook/schema.js';

const MAX_RETRIES = 3;

export async function handleOnboardingName(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const raw = payload.text?.message ?? '';
  const name = raw.trim();
  const retryCount = user.conversation_state?.context.retry_count ?? 0;

  if (name.length < 2 || name.length > 50) {
    const nextRetry = retryCount + 1;

    const message =
      nextRetry >= MAX_RETRIES
        ? 'Envie apenas seu primeiro nome, ex: Maria.'
        : 'Por favor, envie seu nome (entre 2 e 50 caracteres).';

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

  const nameResult = await updateUserName(user.id, name);
  if (nameResult.isErr()) return nameResult;

  const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_TERMS, {});
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_TERMS });

  return sendButtons(
    user.phone,
    'Seus dados serao usados para encontrar pessoas proximas para troca. Aceita?',
    [
      { id: 'terms_accept', label: 'Aceito' },
      { id: 'terms_refuse', label: 'Recuso' },
    ]
  );
}
