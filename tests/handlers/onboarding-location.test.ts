import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));
vi.mock('../../src/services/location.js', () => ({
  saveUserLocation: vi.fn(),
}));

import { handleOnboardingLocation } from '../../src/handlers/onboarding-location.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import * as locationService from '../../src/services/location.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

const mockUser: User = {
  id: 'uuid-1',
  phone: '5511999999999',
  wa_username: null,
  name: 'Maria',
  radius_km: 3,
  conversation_state: { step: ConversationStep.ONBOARDING_LOCATION, context: {}, updated_at: '' },
  consented_at: '2026-04-25T00:00:00Z',
  refused_at: null,
  created_at: '',
};

function makeLocationPayload(lat: number, lng: number): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    location: { latitude: lat, longitude: lng },
  };
}

function makeTextPayload(): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    text: { message: 'Sao Paulo' },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingLocation', () => {
  it('saves location, transitions to ONBOARDING_RADIUS, sends radius buttons', async () => {
    vi.mocked(locationService.saveUserLocation).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingLocation(mockUser, makeLocationPayload(-23.55, -46.63));

    expect(result.isOk()).toBe(true);
    expect(locationService.saveUserLocation).toHaveBeenCalledWith('uuid-1', -23.55, -46.63);
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_RADIUS, {});
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('raio'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'r1' }),
        expect.objectContaining({ id: 'r3' }),
        expect.objectContaining({ id: 'r5' }),
      ])
    );
  });

  it('carries updating_location flag to ONBOARDING_RADIUS when set in context', async () => {
    vi.mocked(locationService.saveUserLocation).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const userWithFlag: User = {
      ...mockUser,
      conversation_state: {
        step: ConversationStep.ONBOARDING_LOCATION,
        context: { updating_location: true },
        updated_at: '',
      },
    };

    await handleOnboardingLocation(userWithFlag, makeLocationPayload(-23.55, -46.63));

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_RADIUS,
      { updating_location: true }
    );
  });

  it('re-prompts when message type is not locationMessage', async () => {
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingLocation(mockUser, makeTextPayload());

    expect(result.isOk()).toBe(true);
    expect(locationService.saveUserLocation).not.toHaveBeenCalled();
    expect(db.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalled();
  });
});
