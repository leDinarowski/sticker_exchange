import { Result, err } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { getWantedListings, findBilateralMatches } from '../db/bilateral.js';
import { formatBilateralList } from '../utils/format-discovery.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText } from '../services/zapi.js';

const WANTS_PROMPT =
  'Quais figurinhas você busca? Envie os códigos. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.';

export async function handleBilateral(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const wantsResult = await getWantedListings(user.id, 'sticker');
  if (wantsResult.isErr()) return err(wantsResult.error);

  if (wantsResult.value.length === 0) {
    logger.info({ userId: user.id, event: 'bilateral_no_wants' });

    const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS, {
      collecting_wants: true,
    });
    if (transitionResult.isErr()) return transitionResult;

    return sendText(phone, WANTS_PROMPT);
  }

  return runBilateralQuery(user, phone);
}

export async function runBilateralQuery(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const resultsResult = await findBilateralMatches(user.id);
  if (resultsResult.isErr()) return err(resultsResult.error);

  const entries = resultsResult.value;

  if (entries.length === 0) {
    logger.info({ userId: user.id, event: 'bilateral_empty' });

    const transitionResult = await transitionState(user.id, ConversationStep.AWAITING_DISCOVERY, {
      watch_mode: 'bilateral',
      watch_attempts: 0,
    });
    if (transitionResult.isErr()) return transitionResult;

    return sendText(
      phone,
      'Nenhum match perfeito encontrado agora.\nVou verificar de hora em hora pelas próximas 6 horas e te aviso assim que encontrar alguém.\nResponda "cancelar" para parar.'
    );
  }

  const transitionResult = await transitionState(user.id, ConversationStep.BROWSING, {
    mode: 'bilateral',
    discovery_list: entries,
  });
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'bilateral_results', count: entries.length });

  return sendText(phone, formatBilateralList(entries));
}
