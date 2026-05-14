import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, recordConsent, recordRefusal } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { WebhookPayload } from '../webhook/schema.js';
import { resolveButtonId } from '../webhook/utils.js';

const BUTTON_LABELS = {
  Aceito: 'terms_accept',
  Recuso: 'terms_refuse',
};

export async function handleOnboardingTerms(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const buttonId = resolveButtonId(payload, BUTTON_LABELS);
  const textInput = payload.text?.message?.trim().toLowerCase() ?? '';

  const isAccept = buttonId === 'terms_accept' || textInput === '1' || textInput === 'aceito';
  const isRefuse = buttonId === 'terms_refuse' || textInput === '2' || textInput === 'recuso';

  if (isAccept) {
    const consentResult = await recordConsent(user.id);
    if (consentResult.isErr()) return consentResult;

    const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LOCATION);
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_LOCATION });

    return sendText(user.phone, 'Agora compartilhe sua localização pelo WhatsApp.');
  }

  if (isRefuse) {
    const refusalResult = await recordRefusal(user.id);
    if (refusalResult.isErr()) return refusalResult;

    logger.info({ userId: user.id, event: 'terms_refused' });

    return sendText(
      user.phone,
      'Entendido. Nenhum dado será armazenado. Se mudar de ideia, envie qualquer mensagem.'
    );
  }

  return sendButtons(
    user.phone,
    'Seus dados serão usados para encontrar pessoas próximas para troca. Aceita?\n\n1️⃣ Aceito\n2️⃣ Recuso',
    [
      { id: 'terms_accept', label: 'Aceito' },
      { id: 'terms_refuse', label: 'Recuso' },
    ]
  );
}
