import { ok, err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { createUser, transitionState, UserIdentifier } from '../db/users.js';
import { ConversationStep } from '../types/index.js';
import { sendText } from '../services/zapi.js';

export async function handleNew(
  identifier: UserIdentifier
): Promise<Result<void, Error>> {
  const phone = identifier.phone ?? identifier.waUsername ?? '';

  const createResult = await createUser(identifier);
  if (createResult.isErr()) return err(createResult.error);

  const user = createResult.value;

  const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_NAME);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_NAME });

  const sendResult = await sendText(phone, 'Bem-vindo ao sticker_exchange. Qual e o seu nome?');
  if (sendResult.isErr()) return sendResult;

  return ok(undefined);
}
