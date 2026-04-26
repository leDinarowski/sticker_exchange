import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/db/bilateral.js', () => ({
  getWantedListings: vi.fn(),
  findBilateralMatches: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleBilateral, runBilateralQuery } from '../../src/handlers/bilateral.js';
import * as db from '../../src/db/users.js';
import * as bilateralDb from '../../src/db/bilateral.js';
import * as zapi from '../../src/services/zapi.js';
import * as idleHandler from '../../src/handlers/idle.js';
import { ConversationStep, DiscoveryEntry, User } from '../../src/types/index.js';

const SAMPLE_ENTRIES: DiscoveryEntry[] = [
  { rank: 1, user_id: 'uuid-b', name: 'Ana', items: ['ARG3', 'ARG4'], dist_m: 800 },
  { rank: 2, user_id: 'uuid-c', name: 'Pedro', items: ['BRA7'], dist_m: 2100 },
];

function makeUser(step = ConversationStep.IDLE): User {
  return {
    id: 'uuid-me',
    phone: '5511999999999',
    wa_username: null,
    name: 'Tester',
    radius_km: 3,
    conversation_state: { step, context: {}, updated_at: '' },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('handleBilateral', () => {
  it('transitions to ONBOARDING_LISTINGS with collecting_wants when user has no wants', async () => {
    vi.mocked(bilateralDb.getWantedListings).mockResolvedValue(ok([]));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleBilateral(makeUser(), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.ONBOARDING_LISTINGS,
      { collecting_wants: true }
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('figurinhas voce busca')
    );
    expect(bilateralDb.findBilateralMatches).not.toHaveBeenCalled();
  });

  it('runs bilateral query when user has wants and results are found', async () => {
    vi.mocked(bilateralDb.getWantedListings).mockResolvedValue(ok(['ARG3', 'ARG4']));
    vi.mocked(bilateralDb.findBilateralMatches).mockResolvedValue(ok(SAMPLE_ENTRIES));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleBilateral(makeUser(), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      expect.objectContaining({ mode: 'bilateral', discovery_list: SAMPLE_ENTRIES })
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Match Perfeito')
    );
  });

  it('propagates DB error from getWantedListings', async () => {
    vi.mocked(bilateralDb.getWantedListings).mockResolvedValue(err(new Error('db fail')));

    const result = await handleBilateral(makeUser(), '5511999999999');

    expect(result.isErr()).toBe(true);
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});

describe('runBilateralQuery', () => {
  it('transitions to BROWSING with bilateral mode when matches are found', async () => {
    vi.mocked(bilateralDb.findBilateralMatches).mockResolvedValue(ok(SAMPLE_ENTRIES));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await runBilateralQuery(makeUser(), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith(
      'uuid-me',
      ConversationStep.BROWSING,
      { mode: 'bilateral', discovery_list: SAMPLE_ENTRIES }
    );
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Ana')
    );
  });

  it('sends no-match message and shows main menu when no bilateral matches found', async () => {
    vi.mocked(bilateralDb.findBilateralMatches).mockResolvedValue(ok([]));
    vi.mocked(db.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await runBilateralQuery(makeUser(), '5511999999999');

    expect(result.isOk()).toBe(true);
    expect(db.transitionState).toHaveBeenCalledWith('uuid-me', ConversationStep.IDLE);
    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('Nenhum match perfeito')
    );
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith('uuid-me', '5511999999999');
  });

  it('propagates DB error from findBilateralMatches', async () => {
    vi.mocked(bilateralDb.findBilateralMatches).mockResolvedValue(err(new Error('geo fail')));

    const result = await runBilateralQuery(makeUser(), '5511999999999');

    expect(result.isErr()).toBe(true);
    expect(db.transitionState).not.toHaveBeenCalled();
  });
});
