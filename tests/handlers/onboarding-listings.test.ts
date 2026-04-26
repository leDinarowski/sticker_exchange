import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  sendList: vi.fn(),
}));
vi.mock('../../src/services/listings.js', () => ({
  applyListingUpdate: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleOnboardingListings } from '../../src/handlers/onboarding-listings.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import * as listingsService from '../../src/services/listings.js';
import * as idle from '../../src/handlers/idle.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makeUser(pendingListings?: string[]): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: 'Maria',
    radius_km: 3,
    conversation_state: {
      step: ConversationStep.ONBOARDING_LISTINGS,
      context: pendingListings ? { pending_listings: pendingListings } : {},
      updated_at: '',
    },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
  };
}

function makeTextPayload(text: string): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    text: { message: text },
  };
}

function makeButtonPayload(buttonId: string): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    buttonsResponseMessage: { selectedButtonId: buttonId },
  };
}

function makeEmptyPayload(): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingListings — parse phase', () => {
  it('parses valid input, sends echo-back, and stores pending in context', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('BRA5, ARG3'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('BRA5'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'confirm_listings' }),
        expect.objectContaining({ id: 'correct_listings' }),
      ])
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { pending_listings: ['BRA5', 'ARG3'] }
    );
  });

  it('sends parse error message and does not transition state on invalid code', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('XYZ5'));

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('Prefixo desconhecido'));
    expect(db.transitionState).not.toHaveBeenCalled();
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });

  it('re-prompts when payload has no text and no pending', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeEmptyPayload());

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('figurinhas'));
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});

describe('handleOnboardingListings — confirmation phase', () => {
  it('saves listings, transitions to IDLE, and shows main menu on [Confirmar] button', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).toHaveBeenCalledWith(
      'uuid-1',
      'sticker',
      { op: 'set', codes: ['BRA5', 'ARG3'] }
    );
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
    expect(idle.showMainMenu).toHaveBeenCalledWith('uuid-1', '5511999999999');
  });

  it('saves listings on text "1" (numeric text fallback for confirm)', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('1'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
  });

  it('clears pending and re-prompts on [Corrigir] button', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('correct_listings'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      {}
    );
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('figurinhas'));
  });

  it('clears pending and re-prompts on text "2" (numeric fallback for corrigir)', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('2'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_LISTINGS, {});
  });

  it('treats new free text while pending as a fresh parse', async () => {
    const user = makeUser(['BRA5']);
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('ARG3'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { pending_listings: ['ARG3'] }
    );
  });

  it('propagates error when applyListingUpdate fails', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(err(new Error('db error')));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isErr()).toBe(true);
  });

  it('re-prompts on unrecognized button when pending exists', async () => {
    const user = makeUser(['BRA5']);
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('some_other_button'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalled();
  });
});
