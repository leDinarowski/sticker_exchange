import { ok, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { User, ConversationStep } from '../types/index.js';
import { transitionState, UserIdentifier } from '../db/users.js';
import { WebhookPayload } from './schema.js';
import { handleNew } from '../handlers/new.js';
import { handleOnboardingName } from '../handlers/onboarding-name.js';
import { handleOnboardingTerms } from '../handlers/onboarding-terms.js';
import { handleOnboardingLocation } from '../handlers/onboarding-location.js';
import { handleOnboardingRadius } from '../handlers/onboarding-radius.js';
import { handleOnboardingListings } from '../handlers/onboarding-listings.js';
import { showMainMenu } from '../handlers/idle.js';
import { handleUpdateLocation } from '../handlers/update-location.js';
import { handleDiscovery, handleBrowsing } from '../handlers/discovery.js';
import { handleBilateral } from '../handlers/bilateral.js';

const IDLE_TEXT_TO_ROW_ID: Record<string, string> = {
  '1': 'discovery',
  '2': 'bilateral',
  '3': 'update_listings',
  '4': 'update_location',
};

export async function route(
  user: User | null,
  identifier: UserIdentifier,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  if (payload.fromMe) return ok(undefined);

  const phone = identifier.phone ?? identifier.waUsername ?? '';

  if (!user) {
    return handleNew(identifier);
  }

  if (user.refused_at && !user.consented_at) {
    const resetResult = await transitionState(user.id, ConversationStep.NEW);
    if (resetResult.isErr()) return resetResult;
    const reOnboardId: UserIdentifier = {};
    if (user.phone) reOnboardId.phone = user.phone;
    if (user.wa_username) reOnboardId.waUsername = user.wa_username;
    return handleNew(reOnboardId);
  }

  const step = user.conversation_state?.step ?? ConversationStep.NEW;
  logger.info({ userId: user.id, step, event: 'routing' });

  switch (step) {
    case ConversationStep.ONBOARDING_NAME:
      return handleOnboardingName(user, payload);

    case ConversationStep.ONBOARDING_TERMS:
      return handleOnboardingTerms(user, payload);

    case ConversationStep.ONBOARDING_LOCATION:
      return handleOnboardingLocation(user, payload);

    case ConversationStep.ONBOARDING_RADIUS:
      return handleOnboardingRadius(user, payload);

    case ConversationStep.ONBOARDING_LISTINGS:
      return handleOnboardingListings(user, payload);

    case ConversationStep.IDLE: {
      const rowId =
        payload.listResponseMessage?.selectedRowId ??
        payload.buttonsResponseMessage?.selectedButtonId ??
        IDLE_TEXT_TO_ROW_ID[payload.text?.message?.trim() ?? ''];

      if (rowId === 'update_location') return handleUpdateLocation(user, phone);
      if (rowId === 'discovery') return handleDiscovery(user, phone);
      if (rowId === 'bilateral') return handleBilateral(user, phone);
      // 'update_listings' → Phase 7
      return showMainMenu(user.id, phone);
    }

    case ConversationStep.BROWSING:
      return handleBrowsing(user, payload, phone);

    case ConversationStep.CONFIRMING_INVENTORY:
    case ConversationStep.AWAITING_MATCH_RESPONSE:
      return showMainMenu(user.id, phone);

    case ConversationStep.NEW:
    default:
      logger.warn({ userId: user.id, step, event: 'unknown_state_fallback' });
      return showMainMenu(user.id, phone);
  }
}
