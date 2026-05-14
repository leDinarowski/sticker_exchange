import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  findUserById: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendButtons: vi.fn(),
}));

import { runTrailingEcho } from '../../src/utils/debounce.js';
import { ConversationStep, User } from '../../src/types/index.js';

function makeUser(overrides: Partial<{
  step: typeof ConversationStep[keyof typeof ConversationStep];
  context: Record<string, unknown>;
}> = {}): User {
  return {
    id: 'u-1',
    phone: '5511999999999',
    wa_username: null,
    name: 'Maria',
    radius_km: 3,
    conversation_state: {
      step: overrides.step ?? ConversationStep.ONBOARDING_LISTINGS,
      context: overrides.context ?? { accumulated_codes: ['BRA5'], pending_op: 'set', last_seq: 100 },
      updated_at: '',
    },
    consented_at: null,
    refused_at: null,
    created_at: '',
    rate_window_start: null,
    rate_window_count: 0,
    location_updated_at: null,
  };
}

const buildEchoText = (codes: string[], op: string, wants: boolean): string =>
  `${wants ? 'Você busca' : op === 'add' ? 'Adicionar' : op === 'remove' ? 'Remover' : 'Lista atual'}: ${codes.join(',')}`;

describe('runTrailingEcho', () => {
  let sleep: ReturnType<typeof vi.fn>;
  let loadUser: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sleep = vi.fn(async () => undefined);
    loadUser = vi.fn();
    send = vi.fn(async () => ok(undefined));
  });

  it('sends echo with two buttons when seq matches and step is ONBOARDING_LISTINGS', async () => {
    loadUser.mockResolvedValue(ok(makeUser()));

    await runTrailingEcho(
      {
        userId: 'u-1',
        phone: '5511999999999',
        seq: 100,
        delayMs: 3500,
        buildEchoText,
      },
      { sleep, loadUser, send }
    );

    expect(sleep).toHaveBeenCalledWith(3500);
    expect(send).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Lista atual'),
      [
        { id: 'confirm_listings', label: 'Confirmar' },
        { id: 'correct_listings', label: 'Corrigir' },
      ]
    );
  });

  it('suppresses echo when seq no longer matches (newer message arrived)', async () => {
    loadUser.mockResolvedValue(
      ok(makeUser({ context: { accumulated_codes: ['BRA5'], pending_op: 'set', last_seq: 200 } }))
    );

    await runTrailingEcho(
      { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
      { sleep, loadUser, send }
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses echo when user has moved off ONBOARDING_LISTINGS state', async () => {
    loadUser.mockResolvedValue(
      ok(makeUser({
        step: ConversationStep.IDLE,
        context: { accumulated_codes: ['BRA5'], pending_op: 'set', last_seq: 100 },
      }))
    );

    await runTrailingEcho(
      { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
      { sleep, loadUser, send }
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when loadUser returns Err (swallowed, no throw)', async () => {
    loadUser.mockResolvedValue(err(new Error('db down')));

    await expect(
      runTrailingEcho(
        { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
        { sleep, loadUser, send }
      )
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when user is missing in DB', async () => {
    loadUser.mockResolvedValue(ok(null));

    await runTrailingEcho(
      { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
      { sleep, loadUser, send }
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('returns gracefully when send fails (swallows error, does not throw)', async () => {
    loadUser.mockResolvedValue(ok(makeUser()));
    send.mockResolvedValue(err(new Error('zapi down')));

    await expect(
      runTrailingEcho(
        { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
        { sleep, loadUser, send }
      )
    ).resolves.toBeUndefined();
  });

  it('uses op:add formatting when context has pending_op:add', async () => {
    loadUser.mockResolvedValue(
      ok(makeUser({ context: { accumulated_codes: ['BRA5'], pending_op: 'add', last_seq: 100 } }))
    );

    await runTrailingEcho(
      { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
      { sleep, loadUser, send }
    );

    expect(send).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Adicionar'),
      expect.any(Array)
    );
  });

  it('uses wants formatting when collecting_wants is true', async () => {
    loadUser.mockResolvedValue(
      ok(makeUser({
        context: { accumulated_codes: ['BRA5'], collecting_wants: true, last_seq: 100 },
      }))
    );

    await runTrailingEcho(
      { userId: 'u-1', phone: '5511999999999', seq: 100, delayMs: 0, buildEchoText },
      { sleep, loadUser, send }
    );

    expect(send).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Você busca'),
      expect.any(Array)
    );
  });
});
