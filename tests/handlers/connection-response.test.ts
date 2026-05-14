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
vi.mock('../../src/db/meeting-places.js', () => ({
  findNearestMeetingPlace: vi.fn(),
}));
vi.mock('../../src/utils/format-meeting-place.js', () => ({
  formatMeetingPlaceMessage: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleAwaitingMatchResponse } from '../../src/handlers/connection-response.js';
import * as usersDb from '../../src/db/users.js';
import * as matchesDb from '../../src/db/matches.js';
import * as zapi from '../../src/services/zapi.js';
import * as idleHandler from '../../src/handlers/idle.js';
import * as meetingPlacesDb from '../../src/db/meeting-places.js';
import * as formatMeetingPlace from '../../src/utils/format-meeting-place.js';
import * as loggerModule from '../../src/utils/logger.js';
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

function makeDisplayButtonPayload(label: string): WebhookPayload {
  return {
    type: 'ReceivedCallback',
    phone: '5522222222222',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    buttonsResponseMessage: { selectedDisplayText: label },
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no place found — keeps existing tests unaffected by the new feature.
  vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(ok(null));
});

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

    expect(zapi.createGroup).toHaveBeenCalledWith(
      expect.stringContaining('Troca'),
      [userA.phone, userB.phone]
    );
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

describe('handleAwaitingMatchResponse — respondent accepts (display text fallback)', () => {
  it('accepts via selectedDisplayText "Sim" when Z-API omits selectedButtonId', async () => {
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
      makeDisplayButtonPayload('Sim'),
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
    expect(zapi.sendText).toHaveBeenCalledWith(userA.phone, expect.stringContaining('não aceitou'));
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

// ─── Meeting place suggestion ────────────────────────────────────────────────

function setupAcceptMocks(userA: User, _userB: User): void {
  vi.mocked(matchesDb.getMatchById).mockResolvedValue(ok(makePendingMatch()));
  vi.mocked(matchesDb.updateMatchStatus).mockResolvedValue(ok(undefined));
  vi.mocked(usersDb.findUserById).mockResolvedValue(ok(userA));
  vi.mocked(zapi.createGroup).mockResolvedValue(ok('groupid@g.us'));
  vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
  vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
  vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));
  // Silence the no-place path by default
  vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(ok(null));
}

describe('meeting place suggestion — place found', () => {
  it('sends place message to group after welcome when a nearby place exists', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    setupAcceptMocks(userA, userB);
    const mockPlace = { id: 'p1', name: 'Cafe X', address: 'Rua Y', neighborhood: 'Pinheiros', distance_m: 300 };
    vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(ok(mockPlace));
    vi.mocked(formatMeetingPlace.formatMeetingPlaceMessage).mockReturnValue('MSG_PLACE');

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isOk()).toBe(true);
    expect(formatMeetingPlace.formatMeetingPlaceMessage).toHaveBeenCalledWith(mockPlace);
    expect(zapi.sendText).toHaveBeenCalledWith('groupid@g.us', 'MSG_PLACE');
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONNECTED);
  });
});

describe('meeting place suggestion — no place found', () => {
  it('completes the flow normally without a place message when no place is within radius', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    setupAcceptMocks(userA, userB);
    vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(ok(null));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(result.isOk()).toBe(true);
    expect(formatMeetingPlace.formatMeetingPlaceMessage).not.toHaveBeenCalled();
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONNECTED);
  });

  it('logs meeting_place_not_found at info level when no place is within radius', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    setupAcceptMocks(userA, userB);
    vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(ok(null));

    await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    expect(vi.mocked(loggerModule.logger.info)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'meeting_place_not_found', matchId: MATCH_ID })
    );
  });
});

describe('meeting place suggestion — query fails (non-fatal)', () => {
  it('continues the flow and returns ok when the meeting place RPC errors', async () => {
    const userB = makeUser(USER_B_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: MATCH_ID,
      pending_target_name: 'Alice',
    });
    const userA = makeUser(USER_A_ID, ConversationStep.AWAITING_MATCH_RESPONSE, {});

    setupAcceptMocks(userA, userB);
    vi.mocked(meetingPlacesDb.findNearestMeetingPlace).mockResolvedValue(err(new Error('rpc failed')));

    const result = await handleAwaitingMatchResponse(
      userB,
      makeButtonPayload(`match_accept_${MATCH_ID}`),
      userB.phone
    );

    // Non-fatal: result is still ok despite the query failure
    expect(result.isOk()).toBe(true);
    // Connection was marked CONNECTED regardless
    expect(matchesDb.updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, MatchStatus.CONNECTED);
    // No place message sent
    expect(formatMeetingPlace.formatMeetingPlaceMessage).not.toHaveBeenCalled();
  });
});
