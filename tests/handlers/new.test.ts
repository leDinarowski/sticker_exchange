import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  createUser: vi.fn(),
  transitionState: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
}));

import { handleNew } from '../../src/handlers/new.js';
import * as db from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';
import { ConversationStep } from '../../src/types/index.js';

const mockUser = { id: 'uuid-1', phone: '5511999999999', wa_username: null, name: null, radius_km: 3, conversation_state: null, consented_at: null, refused_at: null, created_at: '2026-04-25T00:00:00Z' };

beforeEach(() => vi.clearAllMocks());

describe('handleNew', () => {
  it('creates user, transitions to ONBOARDING_NAME, sends welcome text', async () => {
    vi.mocked(db.createUser).mockResolvedValue(ok(mockUser));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleNew({ phone: '5511999999999' });

    expect(result.isOk()).toBe(true);
    expect(db.createUser).toHaveBeenCalledWith({ phone: '5511999999999' });
    expect(db.transitionState).toHaveBeenCalledWith('uuid-1', ConversationStep.ONBOARDING_NAME);
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Bem-vindo')
    );
  });

  it('returns error when createUser fails', async () => {
    vi.mocked(db.createUser).mockResolvedValue(err(new Error('DB error')));

    const result = await handleNew({ phone: '5511999999999' });

    expect(result.isErr()).toBe(true);
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});
