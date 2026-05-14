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
  bumpListingsExpiry: vi.fn(),
}));
vi.mock('../../src/db/bilateral.js', () => ({
  replaceWantedListings: vi.fn(),
}));
vi.mock('../../src/handlers/bilateral.js', () => ({
  runBilateralQuery: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleOnboardingListings } from '../../src/handlers/onboarding-listings.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import * as listingsService from '../../src/services/listings.js';
import * as bilateralDb from '../../src/db/bilateral.js';
import * as bilateralHandler from '../../src/handlers/bilateral.js';
import * as idle from '../../src/handlers/idle.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makeUser(accumulatedCodes?: string[], extraCtx: Record<string, unknown> = {}): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: 'Maria',
    radius_km: 3,
    conversation_state: {
      step: ConversationStep.ONBOARDING_LISTINGS,
      context: { ...(accumulatedCodes ? { accumulated_codes: accumulatedCodes } : {}), ...extraCtx },
      updated_at: '',
    },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
    rate_window_start: null,
    rate_window_count: 0,
    location_updated_at: null,
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

describe('handleOnboardingListings — parse phase (first message)', () => {
  it('parses valid input, sends echo-back with 3 buttons, and stores accumulated_codes in context', async () => {
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
        expect.objectContaining({ id: 'continue_adding' }),
        expect.objectContaining({ id: 'confirm_listings' }),
        expect.objectContaining({ id: 'correct_listings' }),
      ])
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5', 'ARG3'], pending_op: 'set' }
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

  it('re-prompts when payload has no text and no accumulated', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeEmptyPayload());

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('figurinhas'));
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});

describe('handleOnboardingListings — accumulation mode', () => {
  it('accumulates codes from a second message into existing accumulated_codes', async () => {
    const user = makeUser(['BRA5']);
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('ARG3'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5', 'ARG3'], pending_op: 'set' }
    );
  });

  it('deduplicates codes sent across separate messages', async () => {
    const user = makeUser(['BRA5']);
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('BRA5'));

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5'], pending_op: 'set' }
    );
  });

  it('locks pending_op from the first message when user sends additional messages', async () => {
    const user = makeUser(['BRA5'], { pending_op: 'add' });
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    // Second message has no explicit op prefix (would parse as 'set' if standalone)
    await handleOnboardingListings(user, makeTextPayload('ARG3'));

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5', 'ARG3'], pending_op: 'add' }
    );
  });

  it('[Adicionar mais] sends acknowledgment text and does not call transitionState', async () => {
    const user = makeUser(['BRA5']);
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('continue_adding'));

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('Continue'));
    expect(db.transitionState).not.toHaveBeenCalled();
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });
});

describe('handleOnboardingListings — confirmation phase', () => {
  it('saves accumulated_codes, transitions to IDLE, and shows main menu on [Confirmar] button', async () => {
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
    // bumpListingsExpiry not called for 'set' op (full replace already resets expiry)
    expect(listingsService.bumpListingsExpiry).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
    expect(idle.showMainMenu).toHaveBeenCalledWith('uuid-1', '5511999999999');
  });

  it('saves combined accumulated list from multiple messages on [Confirmar]', async () => {
    // Simulates: user sent "BRA5" then "ARG3" as separate messages → both accumulated
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(listingsService.applyListingUpdate).toHaveBeenCalledWith(
      'uuid-1',
      'sticker',
      { op: 'set', codes: ['BRA5', 'ARG3'] }
    );
  });

  it('saves accumulated_codes on text "1" (numeric fallback for confirm)', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('1'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
  });

  it('re-prompts with rePrompt when [Confirmar] tapped but accumulated is empty', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('figurinhas'));
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });

  it('clears accumulated and re-prompts on [Corrigir] button', async () => {
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

  it('clears accumulated and re-prompts on text "2" (numeric fallback for corrigir)', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('2'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_LISTINGS, {});
  });

  it('propagates error when applyListingUpdate fails', async () => {
    const user = makeUser(['BRA5', 'ARG3']);
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(err(new Error('db error')));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isErr()).toBe(true);
  });

  it('re-prompts on unrecognized button when no accumulated codes exist', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('some_other_button'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalled();
  });
});

describe('handleOnboardingListings — differential update (add/remove)', () => {
  it('stores pending_op: add when user sends "adicionar BRA5"', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    await handleOnboardingListings(user, makeTextPayload('adicionar BRA5'));

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5'], pending_op: 'add' }
    );
  });

  it('stores pending_op: remove when user sends "remover BRA5"', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    await handleOnboardingListings(user, makeTextPayload('remover BRA5'));

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { accumulated_codes: ['BRA5'], pending_op: 'remove' }
    );
  });

  it('calls applyListingUpdate with op:add and bumpListingsExpiry on confirm', async () => {
    const user = makeUser(['BRA5'], { pending_op: 'add' });
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(listingsService.bumpListingsExpiry).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).toHaveBeenCalledWith(
      'uuid-1', 'sticker', { op: 'add', codes: ['BRA5'] }
    );
    expect(listingsService.bumpListingsExpiry).toHaveBeenCalledWith('uuid-1', 'sticker');
  });

  it('calls applyListingUpdate with op:remove and bumpListingsExpiry on confirm', async () => {
    const user = makeUser(['BRA5'], { pending_op: 'remove' });
    vi.mocked(listingsService.applyListingUpdate).mockResolvedValue(ok(undefined));
    vi.mocked(listingsService.bumpListingsExpiry).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isOk()).toBe(true);
    expect(listingsService.applyListingUpdate).toHaveBeenCalledWith(
      'uuid-1', 'sticker', { op: 'remove', codes: ['BRA5'] }
    );
    expect(listingsService.bumpListingsExpiry).toHaveBeenCalledWith('uuid-1', 'sticker');
  });
});

describe('handleOnboardingListings — collecting_wants mode', () => {
  it('re-prompts with wants prompt on empty input', async () => {
    const user = makeUser(undefined, { collecting_wants: true });
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeEmptyPayload());

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('figurinhas você busca')
    );
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });

  it('parses wants and sends echo-back with wants-specific text', async () => {
    const user = makeUser(undefined, { collecting_wants: true });
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeTextPayload('BRA5, ARG3'));

    expect(result.isOk()).toBe(true);
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('busca'),
      expect.arrayContaining([expect.objectContaining({ id: 'confirm_listings' })])
    );
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { collecting_wants: true, accumulated_codes: ['BRA5', 'ARG3'] }
    );
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });

  it('accumulates wants across separate messages', async () => {
    const user = makeUser(['BRA5'], { collecting_wants: true });
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));

    await handleOnboardingListings(user, makeTextPayload('ARG3'));

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { collecting_wants: true, accumulated_codes: ['BRA5', 'ARG3'] }
    );
  });

  it('saves combined accumulated wants to wanted_listings and runs bilateral query on confirm', async () => {
    const user = makeUser(['BRA5', 'ARG3'], { collecting_wants: true });
    vi.mocked(bilateralDb.replaceWantedListings).mockResolvedValue(ok(undefined));
    vi.mocked(bilateralHandler.runBilateralQuery).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('confirm_listings'));

    expect(result.isOk()).toBe(true);
    expect(bilateralDb.replaceWantedListings).toHaveBeenCalledWith(
      'uuid-1',
      'sticker',
      ['BRA5', 'ARG3']
    );
    expect(bilateralHandler.runBilateralQuery).toHaveBeenCalled();
    expect(listingsService.applyListingUpdate).not.toHaveBeenCalled();
  });

  it('clears accumulated but preserves collecting_wants on [Corrigir]', async () => {
    const user = makeUser(['BRA5'], { collecting_wants: true });
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(user, makeButtonPayload('correct_listings'));

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LISTINGS,
      { collecting_wants: true }
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('figurinhas você busca')
    );
  });
});
