import { err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { getUserActiveListingsCount } from '../db/listings.js';
import { sendText } from '../services/zapi.js';
import { ConversationStep, User } from '../types/index.js';

const UPDATE_PROMPT =
  'Envie os codigos para substituir sua lista, ou use "adicionar" / "remover" para ajustes. Ex: BRA5, ARG3 ou adicionar FWC8.';

export async function handleUpdateListings(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const countResult = await getUserActiveListingsCount(user.id, 'sticker');
  if (countResult.isErr()) return err(countResult.error);

  const count = countResult.value;
  const intro = count > 0
    ? `Voce tem ${count} figurinha${count === 1 ? '' : 's'} cadastrada${count === 1 ? '' : 's'}. `
    : 'Voce nao tem figurinhas cadastradas ainda. ';

  const sendResult = await sendText(phone, intro + UPDATE_PROMPT);
  if (sendResult.isErr()) return sendResult;

  logger.info({ userId: user.id, event: 'update_listings_started', count });

  return transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS);
}
