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
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleOnboardingRadius } from '../../src/handlers/onboarding-radius.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import * as idleHandler from '../../src/handlers/idle.js';
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

function makeDisplayButtonPayload(label: string): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    buttonsResponseMessage: { selectedDisplayText: label },
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

  it.each([
    ['r1', '1 km', 1],
    ['r3', '3 km', 3],
    ['r5', '5 km', 5],
  ])('saves radius from real Z-API callback {buttonId: %s, message: %s}', async (buttonId, label, expectedKm) => {
    vi.mocked(db.updateUserRadius).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const payload: WebhookPayload = {
      type: 'ReceivedCallback' as const,
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      buttonsResponseMessage: { buttonId, message: label },
    };
    const result = await handleOnboardingRadius(mockUser, payload);

    expect(result.isOk()).toBe(true);
    expect(db.updateUserRadius).toHaveBeenCalledWith('uuid-1', expectedKm);
  });

  it.each([
    ['1 km', 1],
    ['3 km', 3],
    ['5 km', 5],
  ])('saves radius from selectedDisplayText "%s" (legacy format)', async (label, expectedKm) => {
    vi.mocked(db.updateUserRadius).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingRadius(mockUser, makeDisplayButtonPayload(label));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserRadius).toHaveBeenCalledWith('uuid-1', expectedKm);
  });

  it('transitions to IDLE and shows main menu when updating_location is true', async () => {
    vi.mocked(db.updateUserRadius).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const userUpdating: User = {
      ...mockUser,
      conversation_state: {
        step: ConversationStep.ONBOARDING_RADIUS,
        context: { updating_location: true },
        updated_at: '',
      },
    };

    const result = await handleOnboardingRadius(userUpdating, makePayload('r3'));

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('atualizados'));
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith('uuid-1', '5511999999999');
    expect(zapi.sendText).not.toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('figurinhas')
    );
  });
});
