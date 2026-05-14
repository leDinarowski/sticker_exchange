import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

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
import { ConversationStep, ConversationStateContext, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makeUser(retryCount?: number, extraCtx: Partial<ConversationStateContext> = {}): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: null,
    radius_km: 3,
    conversation_state: {
      step: ConversationStep.ONBOARDING_NAME,
      context: {
        ...(retryCount !== undefined ? { retry_count: retryCount } : {}),
        ...extraCtx,
      },
      updated_at: '2026-04-25T00:00:00Z',
    },
    consented_at: null,
    refused_at: null,
    created_at: '2026-04-25T00:00:00Z',
    rate_window_start: null,
    rate_window_count: 0,
    location_updated_at: null,
  };
}

function makePayload(text: string): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    text: { message: text },
  };
}

function makeButtonPayload(buttonId: string): WebhookPayload {
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

describe('handleOnboardingName — parse phase', () => {
  it('stores pending_name and sends echo-back on valid name input', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingName(makeUser(), makePayload('Maria Silva'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      'Nome: Maria Silva\n\nConfirma?',
      expect.arrayContaining([
        expect.objectContaining({ id: 'confirm_name' }),
        expect.objectContaining({ id: 'alter_name' }),
      ])
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { pending_name: 'Maria Silva' }
    );
  });

  it('trims whitespace and sends echo-back with trimmed name', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingName(makeUser(), makePayload('  Ana  '));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      'Nome: Ana\n\nConfirma?',
      expect.any(Array)
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { pending_name: 'Ana' }
    );
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

  it('sends human hint ("primeiro nome") on first retry', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    await handleOnboardingName(makeUser(0), makePayload('X'));

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('primeiro nome')
    );
  });

  it('sends technical constraint message and resets counter after 3 retries', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    await handleOnboardingName(makeUser(3), makePayload('X'));

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('caracteres')
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      { retry_count: 0 }
    );
  });
});

describe('handleOnboardingName — confirmation phase', () => {
  it('saves name, transitions to ONBOARDING_TERMS, and sends terms buttons on [Confirmar] button', async () => {
    vi.mocked(db.updateUserName).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const user = makeUser(undefined, { pending_name: 'Maria Silva' });
    const result = await handleOnboardingName(user, makeButtonPayload('confirm_name'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).toHaveBeenCalledWith('uuid-1', 'Maria Silva');
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_TERMS, {});
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Aceita?'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'terms_accept' }),
        expect.objectContaining({ id: 'terms_refuse' }),
      ])
    );
  });

  it('saves name on text "1" (confirm alias)', async () => {
    vi.mocked(db.updateUserName).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const user = makeUser(undefined, { pending_name: 'Ana' });
    const result = await handleOnboardingName(user, makePayload('1'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).toHaveBeenCalledWith('uuid-1', 'Ana');
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_TERMS, {});
  });

  it('clears pending_name and re-prompts on [Alterar] button', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const user = makeUser(undefined, { pending_name: 'Maria Silva' });
    const result = await handleOnboardingName(user, makeButtonPayload('alter_name'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_NAME,
      {}
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('caracteres')
    );
  });

  it('clears pending_name and re-prompts on text "2" (alter alias)', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const user = makeUser(undefined, { pending_name: 'Ana' });
    const result = await handleOnboardingName(user, makePayload('2'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_NAME, {});
  });

  it('re-prompts on unrecognized input while pending_name is set', async () => {
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const user = makeUser(undefined, { pending_name: 'Maria' });
    const result = await handleOnboardingName(user, makePayload('algo aleatorio'));

    expect(result.isOk()).toBe(true);
    expect(db.updateUserName).not.toHaveBeenCalled();
    expect(db.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalled();
  });

  it('propagates error when updateUserName fails on confirm', async () => {
    vi.mocked(db.updateUserName).mockResolvedValue(err(new Error('db error')));

    const user = makeUser(undefined, { pending_name: 'Ana' });
    const result = await handleOnboardingName(user, makeButtonPayload('confirm_name'));

    expect(result.isErr()).toBe(true);
  });
});
