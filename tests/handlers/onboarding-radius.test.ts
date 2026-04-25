import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
  updateUserRadius: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));

import { handleOnboardingRadius } from '../../src/handlers/onboarding-radius.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

const mockUser: User = {
  id: 'uuid-1',
  phone: '5511999999999',
  wa_username: null,
  name: 'Maria',
  radius_km: 3,
  conversation_state: { step: ConversationStep.ONBOARDING_RADIUS, context: {}, updated_at: '' },
  consented_at: '2026-04-25T00:00:00Z',
  refused_at: null,
  created_at: '',
};

function makePayload(buttonId: string): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    buttonsResponseMessage: { selectedButtonId: buttonId },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingRadius', () => {
  it.each([
    ['r1', 1],
    ['r3', 3],
    ['r5', 5],
  ])('saves radius %s km and transitions to ONBOARDING_LISTINGS', async (buttonId, expectedKm) => {
    vi.mocked(db.updateUserRadius).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingRadius(mockUser, makePayload(buttonId));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserRadius).toHaveBeenCalledWith('uuid-1', expectedKm);
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_LISTINGS);
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('figurinhas')
    );
  });

  it('re-prompts with buttons on invalid button ID', async () => {
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingRadius(mockUser, makePayload('r_invalid'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserRadius).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalled();
  });
});
