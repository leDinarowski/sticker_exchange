import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, updateUserRadius } from '../db/users.js';
import { ConversationStep, User } from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { WebhookPayload } from '../webhook/schema.js';
import { showMainMenu } from './idle.js';

const RADIUS_MAP: Record<string, number> = {
  r1: 1,
  r3: 3,
  r5: 5,
};

const TEXT_TO_RADIUS_ID: Record<string, string> = {
  '1': 'r1',
  '2': 'r3',
  '3': 'r5',
};

export async function handleOnboardingRadius(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const textInput = payload.text?.message?.trim() ?? '';
  const buttonId =
    payload.buttonsResponseMessage?.selectedButtonId ??
    TEXT_TO_RADIUS_ID[textInput] ??
    '';
  const radiusKm = RADIUS_MAP[buttonId];

  if (radiusKm === undefined) {
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

  const radiusResult = await updateUserRadius(user.id, radiusKm);
  if (radiusResult.isErr()) return radiusResult;

  const updatingLocation = user.conversation_state?.context?.updating_location === true;

  if (updatingLocation) {
    const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.IDLE, context: 'update' });

    const sendResult = await sendText(user.phone, 'Localizacao e raio atualizados.');
    if (sendResult.isErr()) return sendResult;

    return showMainMenu(user.id, user.phone);
  }

  const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_LISTINGS);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'state_transition', to: ConversationStep.ONBOARDING_LISTINGS });

  return sendText(
    user.phone,
    'Envie os codigos das suas figurinhas duplicadas. Ex: BRA5, ARG3, FWC8 ou BRA5-10 para intervalo.'
  );
}
