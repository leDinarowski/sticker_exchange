import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText } from '../services/zapi.js';

export async function handleUpdateLocation(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LOCATION, {
    updating_location: true,
  });
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_LOCATION, context: 'update' });

  return sendText(phone, 'Compartilhe sua nova localizacao pelo WhatsApp.');
}
