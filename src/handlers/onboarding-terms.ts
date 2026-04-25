import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, recordConsent, recordRefusal } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { WebhookPayload } from '../webhook/schema.js';

export async function handleOnboardingTerms(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const buttonId = payload.buttonsResponseMessage?.selectedButtonId;

  if (buttonId === 'terms_accept') {
    const consentResult = await recordConsent(user.id);
    if (consentResult.isErr()) return consentResult;

    const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LOCATION);
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_LOCATION });

    return sendText(user.phone, 'Agora compartilhe sua localizacao pelo WhatsApp.');
  }

  if (buttonId === 'terms_refuse') {
    const refusalResult = await recordRefusal(user.id);
    if (refusalResult.isErr()) return refusalResult;

    logger.info({ userId: user.id, event: 'terms_refused' });

    return sendText(
      user.phone,
      'Entendido. Nenhum dado sera armazenado. Se mudar de ideia, envie qualquer mensagem.'
    );
  }

  return sendButtons(
    user.phone,
    'Seus dados serao usados para encontrar pessoas proximas para troca. Aceita?',
    [
      { id: 'terms_accept', label: 'Aceito' },
      { id: 'terms_refuse', label: 'Recuso' },
    ]
  );
}
