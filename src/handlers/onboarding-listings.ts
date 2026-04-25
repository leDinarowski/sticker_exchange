import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { showMainMenu } from './idle.js';

export async function handleOnboardingListings(
  user: User
): Promise<Result<void, Error>> {
  const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.IDLE });

  return showMainMenu(user.id, user.phone);
}
