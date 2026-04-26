import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock('../../src/db/discovery.js', () => ({
  findNearbyUsers: vi.fn(),
}));
vi.mock('../../src/db/matches.js', () => ({
  createMatch: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleDiscovery, handleBrowsing } from '../../src/handlers/discovery.js';
import * as db from '../../src/db/users.js';
import * as discoveryDb from '../../src/db/discovery.js';
import * as matchesDb from '../../src/db/matches.js';
import * as zapi from '../../src/services/zapi.js';
import * as idleHandler from '../../src/handlers/idle.js';
import { ConversationStep, DiscoveryEntry, Match, MatchStatus, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

const SAMPLE_ENTRIES: DiscoveryEntry[] = [
  { rank: 1, user_id: 'uuid-a', name: 'Joao', items: ['BRA3', 'BRA5', 'ARG4'], dist_m: 1200 },
  { rank: 2, user_id: 'uuid-b', name: 'Maria', items: ['ARG1', 'ARG2'], dist_m: 3400 },
];

function makeUser(step: ConversationStep, ctx = {}): User {
  return {
    id: 'uuid-me',
    phone: '5511999999999',
    wa_username: null,
    name: 'Tester',
    radius_km: 3,
    conversation_state: { step, context: ctx, updated_at: '' },
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

beforeEach(() => vi.clearAllMocks());

describe('handleDiscovery', () => {
  it('transitions to BROWSING and sends discovery list when users found', async () => {
    vi.mocked(discoveryDb.findNearbyUsers).mockResolvedValue(ok(SAMPLE_ENTRIES));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const user = makeUser(ConversationStep.IDLE);
    const result = await handleDiscovery(user, '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      expect.objectContaining({ mode: 'discovery', discovery_list: SAMPLE_ENTRIES })
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Joao')
    );
  });

  it('transitions to ONBOARDING_RADIUS with updating_location when no users found', async () => {
    vi.mocked(discoveryDb.findNearbyUsers).mockResolvedValue(ok([]));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const user = makeUser(ConversationStep.IDLE);
    const result = await handleDiscovery(user, '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.ONBOARDING_RADIUS,
      { updating_location: true }
    );
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Nenhuma'),
      expect.arrayContaining([expect.objectContaining({ id: 'r1' })])
    );
  });

  it('propagates DB error from findNearbyUsers', async () => {
    vi.mocked(discoveryDb.findNearbyUsers).mockResolvedValue(err(new Error('geo fail')));

    const result = await handleDiscovery(makeUser(ConversationStep.IDLE), '5511999999999');

    expect(result.isErr()).toBe(true);
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});

describe('handleBrowsing — list selection (no selected_indices)', () => {
  it('parses selection and shows profiles', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = { mode: 'discovery' as const, discovery_list: SAMPLE_ENTRIES };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    const result = await handleBrowsing(user, makeTextPayload('1'), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      expect.objectContaining({ selected_indices: [1] })
    );
    expect(zapi.sendText).toHaveBeenCalledWith('5511999999999', expect.stringContaining('Joao'));
  });

  it('parses multi-selection and shows multiple profiles', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = { mode: 'discovery' as const, discovery_list: SAMPLE_ENTRIES };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    await handleBrowsing(user, makeTextPayload('1,2'), '5511999999999');

    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      expect.objectContaining({ selected_indices: [1, 2] })
    );
  });

  it('re-sends discovery list on invalid selection input', async () => {
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = { mode: 'discovery' as const, discovery_list: SAMPLE_ENTRIES };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    await handleBrowsing(user, makeTextPayload('abc'), '5511999999999');

    expect(db.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Pessoas perto de voce')
    );
  });

  it('falls back to main menu when discovery_list is empty', async () => {
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const user = makeUser(ConversationStep.BROWSING, {});
    await handleBrowsing(user, makeTextPayload('1'), '5511999999999');

    expect(idleHandler.showMainMenu).toHaveBeenCalledWith('uuid-me', '5511999999999');
  });
});

describe('handleBrowsing — action selection (with selected_indices)', () => {
  it('handles Voltar by clearing selection and re-showing discovery list', async () => {
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = {
      mode: 'discovery' as const,
      discovery_list: SAMPLE_ENTRIES,
      selected_indices: [1],
    };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    // selected = [Joao] → voltarIndex = 2
    const result = await handleBrowsing(user, makeTextPayload('2'), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      expect.not.objectContaining({ selected_indices: expect.anything() })
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Pessoas perto de voce')
    );
  });

  it('contact: creates match, notifies User B, transitions User A to AWAITING_MATCH_RESPONSE', async () => {
    const fakeMatch: Match = {
      id: 'match-123',
      user_a_id: 'uuid-me',
      user_b_id: 'uuid-a',
      status: MatchStatus.PENDING,
      created_at: '',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const userB: User = {
      id: 'uuid-a',
      phone: '5511000000001',
      wa_username: null,
      name: 'Joao',
      radius_km: 3,
      conversation_state: { step: ConversationStep.IDLE, context: {}, updated_at: '' },
      consented_at: '',
      refused_at: null,
      created_at: '',
    };

    vi.mocked(matchesDb.createMatch).mockResolvedValue(ok(fakeMatch));
    vi.mocked(db.findUserById).mockResolvedValue(ok(userB));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = {
      mode: 'discovery' as const,
      discovery_list: SAMPLE_ENTRIES,
      selected_indices: [1],
    };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    // selected = [Joao] → option 1 = contact Joao, voltarIndex = 2
    const result = await handleBrowsing(user, makeTextPayload('1'), '5511999999999');

    expect(result.isOk()).toBe(true);

    // Match created with correct users
    expect(matchesDb.createMatch).toHaveBeenCalledWith('uuid-me', 'uuid-a');

    // User B transitioned to AWAITING_MATCH_RESPONSE (respondent)
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-a',
      ConversationStep.AWAITING_MATCH_RESPONSE,
      expect.objectContaining({ pending_match_id: 'match-123' })
    );

    // User B notified with accept/decline buttons
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      '5511000000001',
      expect.stringContaining('quer trocar'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'match_accept_match-123' }),
        expect.objectContaining({ id: 'match_decline_match-123' }),
      ])
    );

    // User A transitioned to AWAITING_MATCH_RESPONSE (initiator)
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.AWAITING_MATCH_RESPONSE,
      expect.objectContaining({ pending_match_ids: ['match-123'] })
    );

    // User A notified
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Pedido enviado')
    );
  });

  it('re-sends profile on invalid action input', async () => {
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const ctx = {
      mode: 'discovery' as const,
      discovery_list: SAMPLE_ENTRIES,
      selected_indices: [1],
    };
    const user = makeUser(ConversationStep.BROWSING, ctx);
    await handleBrowsing(user, makeTextPayload('xyz'), '5511999999999');

    expect(db.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Entrar em contato')
    );
  });
});
