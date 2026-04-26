import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock('../../src/db/matches.js', () => ({
  getMatchById: vi.fn(),
  updateMatchStatus: vi.fn(),
  getPendingMatchesForUserA: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  createGroup: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));

import { handleAwaitingMatchResponse } from '../../src/handlers/connection-response.js';
import * as usersDb from '../../src/db/users.js';
import * as matchesDb from '../../src/db/matches.js';
import * as zapi from '../../src/services/zapi.js';
import * as idleHandler from '../../src/handlers/idle.js';
import { ConversationStep, Match, MatchStatus, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

const MATCH_ID = 'match-uuid-1';
const USER_A_ID = 'uuid-a';
const USER_B_ID = 'uuid-b';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function makePendingMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: MATCH_ID,
    user_a_id: USER_A_ID,
    user_b_id: USER_B_ID,
    status: MatchStatus.PENDING,
    created_at: new Date().toISOString(),
    expires_at: FUTURE,
    ...overrides,
  };
}

function makeUser(id: string, step: ConversationStep, ctx = {}): User {
  return {
    id,
    phone: id === USER_A_ID ? '5511111111111' : '5522222222222',
    wa_username: null,
    name: id === USER_A_ID ? 'Alice' : 'Bob',
    radius_km: 3,
    conversation_state: { step, context: ctx, updated_at: '' },
    consented_at: '2026-04-25T00:00:00Z',
    refused_at: null,
    created_at: '',
  };
}

function makeButtonPayload(buttonId: string): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5522222222222',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    buttonsResponseMessage: { selectedButtonId: buttonId },
  };
}

function makeTextPayload(text: string): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5522222222222',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    text: { message: text },
  };
}

beforeEach(() => vi.clearAllMocks());

// ─── Respondent: accept path ─────────────────────────────────────────────────

describe('handleAwaitingMatchResponse — respondent accepts (button)', () => {
  it('creates group, sends welcome, notifies both users, returns them to IDLE', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch()));
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.findUserById).mockResolvedValue(ok(userA));
    vi.mocked(zapi.createGroup).mockResolvedValue(ok('groupid@g.us'));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isOk()).toBe(true);

    expect(zapi.createGroup).toHaveBeenCalledWith('Troca de Figurinhas', [
      userA.phone,
      userB.phone,
    ]);
    expect(zapi.sendText).toHaveBeenCalledWith('groupid@g.us', expect.stringContaining('Combinado'));
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONFIRMED_B);
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONNECTED);
    expect(zapi.sendText).toHaveBeenCalledWith(userA.phone, expect.stringContaining('aceitou'));
    expect(usersDb.transitionState).toHaveBeenCalledWith(userA.id, ConversationStep.IDLE);
    expect(usersDb.transitionState).toHaveBeenCalledWith(userB.id, ConversationStep.IDLE);
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith(userA.id, userA.phone);
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith(userB.id, userB.phone);
  });
});

describe('handleAwaitingMatchResponse — respondent accepts (text fallback "1")', () => {
  it('same accept outcome via plain text "1"', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch()));
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.findUserById).mockResolvedValue(ok(userA));
    vi.mocked(zapi.createGroup).mockResolvedValue(ok('groupid@g.us'));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeTextPayload('1'),
      userB.phone
    );

    expect(result.isOk()).toBe(true);
    expect(zapi.createGroup).toHaveBeenCalled();
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONNECTED);
  });
});

// ─── Respondent: decline path ────────────────────────────────────────────────

describe('handleAwaitingMatchResponse — respondent declines (button)', () => {
  it('updates to DECLINED, notifies User A, returns both to IDLE, no group created', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch()));
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.findUserById).mockResolvedValue(ok(userA));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_decline_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isOk()).toBe(true);
    expect(zapi.createGroup).not.toHaveBeenCalled();
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.DECLINED);
    expect(zapi.sendText).toHaveBeenCalledWith(userA.phone, expect.stringContaining('nao aceitou'));
    expect(usersDb.transitionState).toHaveBeenCalledWith(userA.id, ConversationStep.IDLE);
    expect(usersDb.transitionState).toHaveBeenCalledWith(userB.id, ConversationStep.IDLE);
  });
});

describe('handleAwaitingMatchResponse — respondent declines (text fallback "2")', () => {
  it('same decline outcome via plain text "2"', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch()));
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.findUserById).mockResolvedValue(ok(userA));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(userB, makeTextPayload('2'), userB.phone);

    expect(result.isOk()).toBe(true);
    expect(zapi.createGroup).not.toHaveBeenCalled();
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.DECLINED);
  });
});

// ─── Respondent: expired match ───────────────────────────────────────────────

describe('handleAwaitingMatchResponse — match already expired', () => {
  it('updates to EXPIRED, notifies User B, no group, returns User B to IDLE', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch({ expires_at: PAST })));
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isOk()).toBe(true);
    expect(zapi.createGroup).not.toHaveBeenCalled();
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.EXPIRED);
    expect(zapi.sendText).toHaveBeenCalledWith(userB.phone, expect.stringContaining('expirou'));
    expect(usersDb.transitionState).toHaveBeenCalledWith(userB.id, ConversationStep.IDLE);
  });
});

// ─── Respondent: unknown input re-prompts ────────────────────────────────────

describe('handleAwaitingMatchResponse — respondent sends unknown input', () => {
  it('re-sends the consent prompt without state change', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });

    vi.mocked(zapi.sendButtons).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(userB, makeTextPayload('xyz'), userB.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
    expect(matchesDb.getMatchById).not.toHaveBeenCalled();
    expect(zapi.sendButtons).toHaveBeenCalledWith(
      userB.phone,
      expect.stringContaining('Alice'),
      expect.arrayContaining([
        expect.objectContaining({ id: `match_accept_${MATCH_ID}` }),
        expect.objectContaining({ id: `match_decline_${MATCH_ID}` }),
      ])
    );
  });
});

// ─── Initiator: still waiting ────────────────────────────────────────────────

describe('handleAwaitingMatchResponse — initiator with active pending matches', () => {
  it('sends "still waiting" message without state change', async () => {
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_ids: [MATCH_ID],
    });

    vi.mocked(matchesDb.getPendingMatchesForUserA).mockResolvedValue(ok([makePendingMatch()]));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(userA, makeTextPayload('oi'), userA.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).not.toHaveBeenCalled();
    expect(zapi.sendText).toHaveBeenCalledWith(userA.phone, expect.stringContaining('aguardando'));
  });
});

// ─── Initiator: all matches expired ─────────────────────────────────────────

describe('handleAwaitingMatchResponse — initiator with all matches expired', () => {
  it('marks all EXPIRED, sends expiry message, returns to IDLE', async () => {
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_ids: [MATCH_ID],
    });

    vi.mocked(matchesDb.getPendingMatchesForUserA).mockResolvedValue(
      ok([makePendingMatch({ expires_at: PAST })])
    );
    vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(userA, makeTextPayload('oi'), userA.phone);

    expect(result.isOk()).toBe(true);
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.EXPIRED);
    expect(usersDb.transitionState).toHaveBeenCalledWith(userA.id, ConversationStep.IDLE);
    expect(zapi.sendText).toHaveBeenCalledWith(userA.phone, expect.stringContaining('expirou'));
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith(userA.id, userA.phone);
  });
});

// ─── Initiator: no pending matches (already resolved) ───────────────────────

describe('handleAwaitingMatchResponse — initiator with no pending matches', () => {
  it('transitions to IDLE and shows main menu', async () => {
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_ids: [],
    });

    vi.mocked(matchesDb.getPendingMatchesForUserA).mockResolvedValue(ok([]));
    vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));

    const result = await handleAwaitingMatchResponse(userA, makeTextPayload('oi'), userA.phone);

    expect(result.isOk()).toBe(true);
    expect(usersDb.transitionState).toHaveBeenCalledWith(userA.id, ConversationStep.IDLE);
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith(userA.id, userA.phone);
  });
});

// ─── Error propagation ───────────────────────────────────────────────────────

describe('handleAwaitingMatchResponse — DB error propagates', () => {
  it('returns err when getMatchById fails', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });

    vi.mocked(matchesDb.getMatchById).mockResolvedValue(err(new Error('db fail')));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isErr()).toBe(true);
    expect(zapi.createGroup).not.toHaveBeenCalled();
  });
});
