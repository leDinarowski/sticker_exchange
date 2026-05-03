import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/db/listings.js', () => ({
  getUserActiveListingsCount: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
}));

import { handleUpdateListings } from '../../src/handlers/update-listings.js';
import * as usersDb from '../../src/db/users.js';
import * as listingsDb from '../../src/db/listings.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep, User } from '../../src/types/index.js';

function makeUser(): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: 'Maria',
    radius_km: 3,
    conversation_state: { step: ConversationStep.IDLE, context: {}, updated_at: '' },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleUpdateListings', () => {
  it('shows count and transitions to ONBOARDING_LISTINGS when user has listings', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(5));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleUpdateListings(user, user.phone);

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith(
      user.phone,
      expect.stringContaining('5 figurinhas')
    );
    expect(usersDb.transitionState).toHaveBeenCalledWith(
      user.id,
      ConversationStep.ONBOARDING_LISTINGS
    );
  });

  it('shows empty-inventory message when user has no listings', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(0));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));

    const result = await handleUpdateListings(user, user.phone);

    expect(result.isOk()).toBe(true);
    expect(zapi.sendText).toHaveBeenCalledWith(
      user.phone,
      expect.stringContaining('não tem figurinhas')
    );
    expect(usersDb.transitionState).toHaveBeenCalledWith(
      user.id,
      ConversationStep.ONBOARDING_LISTINGS
    );
  });

  it('uses singular form for exactly 1 listing', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(1));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));

    await handleUpdateListings(user, user.phone);

    const msg = vi.mocked(zapi.sendText).mock.calls[0]![1];
    expect(msg).toContain('1 figurinha ');
    expect(msg).not.toContain('figurinhas ');
  });

  it('propagates error from getUserActiveListingsCount', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(err(new Error('db error')));

    const result = await handleUpdateListings(user, user.phone);

    expect(result.isErr()).toBe(true);
    expect(zapi.sendText).not.toHaveBeenCalled();
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });

  it('propagates error from sendText without transitioning', async () => {
    const user = makeUser();
    vi.mocked(listingsDb.getUserActiveListingsCount).mockResolvedValue(ok(3));
    vi.mocked(zapi.sendText).mockResolvedValue(err(new Error('zapi error')));

    const result = await handleUpdateListings(user, user.phone);

    expect(result.isErr()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
  });
});
