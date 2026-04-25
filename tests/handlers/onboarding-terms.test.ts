import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
  recordConsent: vi.fn(),
  recordRefusal: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));

import { handleOnboardingTerms } from '../../src/handlers/onboarding-terms.js';
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
  conversation_state: { step: ConversationStep.ONBOARDING_TERMS, context: {}, updated_at: '' },
  consented_at: null,
  refused_at: null,
  created_at: '',
};

function makePayload(buttonId?: string): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    message: {
      messageId: 'msg-1',
      fromMe: false,
      type: 'buttonsResponseMessage' as const,
      buttonsResponseMessage: buttonId ? { selectedButtonId: buttonId } : undefined,
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingTerms', () => {
  it('records consent and transitions to ONBOARDING_LOCATION on terms_accept', async () => {
    vi.mocked(db.recordConsent).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingTerms(mockUser, makePayload('terms_accept'));

    expect(result.isOk()).toBe(true);
    expect(db.recordConsent).toHaveBeenCalledWith('uuid-1');
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_LOCATION);
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('localizacao')
    );
  });

  it('records refusal and sends goodbye on terms_refuse', async () => {
    vi.mocked(db.recordRefusal).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingTerms(mockUser, makePayload('terms_refuse'));

    expect(result.isOk()).toBe(true);
    expect(db.recordRefusal).toHaveBeenCalledWith('uuid-1');
    expect(db.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Nenhum dado')
    );
  });

  it('re-prompts with terms buttons on non-button input', async () => {
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingTerms(mockUser, makePayload());

    expect(result.isOk()).toBe(true);
    expect(db.recordConsent).not.toHaveBeenCalled();
    expect(db.recordRefusal).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalled();
  });
});
