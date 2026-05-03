import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));
vi.mock('../../src/services/listings.js', () => ({
  bumpListingsExpiry: vi.fn(),
  clearUserListings: vi.fn(),
}));
vi.mock('../../src/db/listings.js', () => ({
  getUserActiveListingsCount: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleConfirmingInventory, sendExpiryNudge } from '../../src/handlers/confirming-inventory.js';
import * as usersDb from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import * as listingsService from '../../src/services/listings.js';
import * as listingsDb from '../../src/db/listings.js';
import * as idle from '../../src/handlers/idle.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makeUser(ctx: Record<string, unknown> = {}): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: 'Maria',
    radius_km: 3,
    conversation_state: { step: ConversationStep.CONFIRMING_INVENTORY, context: ctx, updated_at: '' },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
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

describe('handleConfirmingInventory — [Sim, ainda tenho]', () => {
  it('bumps expiry, transitions to IDLE, shows main menu on button tap', async () => {
    const user = makeUser();
    vi.mocked(listingsService.bumpListingsExpiry).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeButtonPayload('inv_keep'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(listingsService.bumpListingsExpiry).toHaveBeenCalledWith(user.id, 'sticker');
    expect(usersDb.transitionState).toHaveBeenCalledWith(user.id, ConversationStep.IDLE);
    expect(idle.showMainMenu).toHaveBeenCalledWith(user.id, user.phone);
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
  });

  it('handles text "1" (trial account fallback)', async () => {
    const user = makeUser();
    vi.mocked(listingsService.bumpListingsExpiry).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeTextPayload('1'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(listingsService.bumpListingsExpiry).toHaveBeenCalled();
  });

  it('propagates error when bumpListingsExpiry fails', async () => {
    const user = makeUser();
    vi.mocked(listingsService.bumpListingsExpiry).mockResolvedValue(err(new Error('db error')));

    const result = await handleConfirmingInventory(user, makeButtonPayload('inv_keep'), user.phone);

    expect(result.isErr()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });
});

describe('handleConfirmingInventory — [Atualizar Figurinhas]', () => {
  it('shows count, transitions to ONBOARDING_LISTINGS and sends update prompt on button tap', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(5));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeButtonPayload('inv_update'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).toHaveBeenCalledWith(user.id, ConversationStep.ONBOARDING_LISTINGS);
    expect(zapi.sendText).toHaveBeenCalledWith(user.phone, expect.stringContaining('substituir'));
    expect(listingsService.bumpListingsExpiry).not.toHaveBeenCalled();
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
  });

  it('handles text "2" (trial account fallback)', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(3));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeTextPayload('2'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).toHaveBeenCalledWith(user.id, ConversationStep.ONBOARDING_LISTINGS);
  });
});

describe('handleConfirmingInventory — [Não tenho mais] — confirmation step', () => {
  it('shows confirmation prompt when user taps "Não tenho mais" button (does NOT clear yet)', async () => {
    const user = makeUser();
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeButtonPayload('inv_clear'), user.phone);

    expect(result.isOk()).toBe(true);
    // Sets pending_clear flag before showing confirmation
    expect(usersDb.transitionState).toHaveBeenCalledWith(
      user.id,
      ConversationStep.CONFIRMING_INVENTORY,
      { pending_clear: true }
    );
    // Shows confirmation buttons — does NOT clear listings yet
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      user.phone,
      expect.stringContaining('Tem certeza'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'clear_confirm' }),
        expect.objectContaining({ id: 'clear_cancel' }),
      ])
    );
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
  });

  it('handles text "3" — also shows confirmation (trial account fallback)', async () => {
    const user = makeUser();
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeTextPayload('3'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).toHaveBeenCalledWith(
      user.id,
      ConversationStep.CONFIRMING_INVENTORY,
      { pending_clear: true }
    );
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
  });

  it('clears listings when user confirms with clear_confirm button', async () => {
    const user = makeUser({ pending_clear: true });
    vi.mocked(listingsService.clearUserListings).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeButtonPayload('clear_confirm'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(listingsService.clearUserListings).toHaveBeenCalledWith(user.id, 'sticker');
    expect(usersDb.transitionState).toHaveBeenCalledWith(user.id, ConversationStep.IDLE);
    expect(zapi.sendText).toHaveBeenCalledWith(user.phone, expect.stringContaining('removidas'));
    expect(idle.showMainMenu).toHaveBeenCalledWith(user.id, user.phone);
  });

  it('keeps listings when user cancels with clear_cancel button', async () => {
    const user = makeUser({ pending_clear: true });
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(idle.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeButtonPayload('clear_cancel'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalledWith(user.phone, expect.stringContaining('mantidas'));
    expect(idle.showMainMenu).toHaveBeenCalledWith(user.id, user.phone);
  });

  it('propagates error when clearUserListings fails during confirmation', async () => {
    const user = makeUser({ pending_clear: true });
    vi.mocked(listingsService.clearUserListings).mockResolvedValue(err(new Error('db error')));

    const result = await handleConfirmingInventory(user, makeButtonPayload('clear_confirm'), user.phone);

    expect(result.isErr()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });
});

describe('handleConfirmingInventory — unknown input', () => {
  it('re-sends nudge buttons when user sends unrecognized text', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeTextPayload('oi'), user.phone);

    expect(result.isOk()).toBe(true);
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      user.phone,
      expect.stringContaining('disponíveis'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'inv_keep' }),
        expect.objectContaining({ id: 'inv_update' }),
        expect.objectContaining({ id: 'inv_clear' }),
      ])
    );
    expect(listingsService.bumpListingsExpiry).not.toHaveBeenCalled();
    expect(listingsService.clearUserListings).not.toHaveBeenCalled();
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });

  it('re-sends nudge buttons on empty payload', async () => {
    const user = makeUser();
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleConfirmingInventory(user, makeEmptyPayload(), user.phone);

    expect(result.isOk()).toBe(true);
    expect(zapi.sendButtons).toHaveBeenCalled();
  });
});

describe('sendExpiryNudge', () => {
  it('sends buttons and transitions to CONFIRMING_INVENTORY', async () => {
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));

    const result = await sendExpiryNudge({ id: 'uuid-1', phone: '5511999999999' });

    expect(result.isOk()).toBe(true);
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('disponíveis'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'inv_keep' }),
        expect.objectContaining({ id: 'inv_update' }),
        expect.objectContaining({ id: 'inv_clear' }),
      ])
    );
    expect(usersDb.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.CONFIRMING_INVENTORY);
  });

  it('propagates error if sendButtons fails without transitioning state', async () => {
    vi.mocked(zapi.sendButtons).mockResolvedValue(err(new Error('zapi error')));

    const result = await sendExpiryNudge({ id: 'uuid-1', phone: '5511999999999' });

    expect(result.isErr()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });
});
