import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
}));

import { handleUpdateLocation } from '../../src/handlers/update-location.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep, User } from '../../src/types/index.js';

const mockUser: User = {
  id: 'uuid-1',
  phone: '5511999999999',
  wa_username: null,
  name: 'Joao',
  radius_km: 3,
  conversation_state: { step: ConversationStep.IDLE, context: {}, updated_at: '' },
  consented_at: '2026-04-25T00:00:00Z',
  refused_at: null,
  created_at: '',
};

beforeEach(() => vi.clearAllMocks());

describe('handleUpdateLocation', () => {
  it('transitions to ONBOARDING_LOCATION with updating_location flag', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleUpdateLocation(mockUser, '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-1',
      ConversationStep.ONBOARDING_LOCATION,
      { updating_location: true }
    );
  });

  it('sends location request message', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    await handleUpdateLocation(mockUser, '5511999999999');

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('localizacao')
    );
  });

  it('propagates DB error', async () => {
    vi.mocked(db.transitionState).mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('db fail') } as never);

    const result = await handleUpdateLocation(mockUser, '5511999999999');

    expect(result.isErr()).toBe(true);
    expect(zapi.sendText).not.toHaveBeenCalled();
  });
});
