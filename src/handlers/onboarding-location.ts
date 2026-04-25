import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { saveUserLocation } from '../services/location.js';
import { WebhookPayload } from '../webhook/schema.js';

export async function handleOnboardingLocation(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  if (!payload.location) {
    return sendText(
      user.phone,
      'Use o botao de localizacao do WhatsApp para compartilhar sua localizacao.'
    );
  }

  const { latitude, longitude } = payload.location;

  const locationResult = await saveUserLocation(user.id, latitude, longitude);
  if (locationResult.isErr()) return locationResult;

  const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_RADIUS);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_RADIUS });

  return sendButtons(
    user.phone,
    'Qual e o seu raio de busca?',
    [
      { id: 'r1', label: '1 km' },
      { id: 'r3', label: '3 km' },
      { id: 'r5', label: '5 km' },
    ]
  );
}
