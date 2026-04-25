import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
  updateUserName: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));

import { handleOnboardingName } from '../../src/handlers/onboarding-name.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makeUser(retryCount?: number): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: null,
    radius_km: 3,
    conversation_state: {
      step: ConversationStep.ONBOARDING_NAME,
      context: retryCount !== undefined ? { retry_count: retryCount } : {},
      updated_at: '2026-04-25T00:00:00Z',
    },
    consented_at: null,
    refused_at: null,
    created_at: '2026-04-25T00:00:00Z',
  };
}

function makePayload(text: string): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    message: {
      messageId: 'msg-1',
      fromMe: false,
      type: 'text' as const,
      text: { message: text },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingName', () => {
  it('saves valid name and transitions to ONBOARDING_TERMS', async () => {
    vi.mocked(db.updateUserName).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingName(makeUser(), makePayload('Maria Silva'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).toHaveBeenCalledWith('uuid-1', 'Maria Silva');
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_TERMS, {});
    expect(zapi.sendButtons).toHaveBeenCalled();
  });

  it('re-prompts and increments retry_count on too-short name', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingName(makeUser(0), makePayload('A'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { retry_count: 1 }
    );
  });

  it('re-prompts and increments retry_count on too-long name', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const longName = 'A'.repeat(51);
    const result = await handleOnboardingName(makeUser(1), makePayload(longName));

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { retry_count: 2 }
    );
  });

  it('sends gentler copy and resets counter after 3 retries', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    await handleOnboardingName(makeUser(3), makePayload('X'));

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('primeiro nome')
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { retry_count: 0 }
    );
  });

  it('trims whitespace before validation', async () => {
    vi.mocked(db.updateUserName).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    await handleOnboardingName(makeUser(), makePayload('  Ana  '));

    expect(db.updateUserName).toHaveBeenCalledWith('uuid-1', 'Ana');
  });
});
