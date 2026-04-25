import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendList: vi.fn(),
}));

import { handleOnboardingListings } from '../../src/handlers/onboarding-listings.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep, User } from '../../src/types/index.js';

const mockUser: User = {
  id: 'uuid-1',
  phone: '5511999999999',
  wa_username: null,
  name: 'Maria',
  radius_km: 3,
  conversation_state: { step: ConversationStep.ONBOARDING_LISTINGS, context: {}, updated_at: '' },
  consented_at: '2026-04-25T00:00:00Z',
  refused_at: null,
  created_at: '',
};

beforeEach(() => vi.clearAllMocks());

describe('handleOnboardingListings (Phase 1 stub)', () => {
  it('transitions to IDLE and shows main menu on any input', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendList).mockResolvedValue(ok(undefined));

    const result = await handleOnboardingListings(mockUser);

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.IDLE);
    expect(zapi.sendList).toHaveBeenCalledWith(
      '5511999999999',
      expect.any(String),
      expect.any(String),
      expect.any(Array)
    );
  });
});
