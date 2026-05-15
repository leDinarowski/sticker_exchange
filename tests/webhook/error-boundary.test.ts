import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  findUser: vi.fn(),
  checkRateLimit: vi.fn(),
  transitionState: vi.fn(),
  UserIdentifier: {},
}));
vi.mock('../../src/webhook/router.js', () => ({
  route: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
}));

import handler from '../../api/webhook.js';
import * as usersDb from '../../src/db/users.js';
import * as router from '../../src/webhook/router.js';
import * as zapi from '../../src/services/zapi.js';

const GROUP_PAYLOAD = {
  type: 'ReceivedCallback',
  phone: '120363043597026220@g.us',
  instanceId: 'test-instance',
  messageId: 'test-msg-id',
  fromMe: false,
  text: { message: 'oi' },
};

const VALID_PAYLOAD = {
  type: 'ReceivedCallback',
  phone: '5511999999999',
  instanceId: 'test-instance',
  messageId: 'test-msg-id',
  fromMe: false,
  text: { message: 'oi' },
};

function makeReq(body: Record<string, unknown> = VALID_PAYLOAD): { method: string; headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    method: 'POST',
    headers: { 'z-api-token': 'test-token' },
    body,
  };
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const MOCK_USER = {
  id: 'user-uuid',
  phone: '5511999999999',
  conversation_state: { step: 'IDLE', context: {}, updated_at: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['ZAPI_TOKEN'] = 'test-token';
  vi.mocked(usersDb.findUser).mockResolvedValue(ok(MOCK_USER as never));
  vi.mocked(usersDb.checkRateLimit).mockResolvedValue(ok(true));
  vi.mocked(usersDb.transitionState).mockResolvedValue(ok(undefined));
  vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
});

describe('group JID guard in webhook handler', () => {
  it('returns 200 silently without calling findUser when phone is a group JID', async () => {
    const req = makeReq(GROUP_PAYLOAD);
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.findUser).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 200 silently when payload has isGroup: true (no @g.us suffix)', async () => {
    const req = makeReq({
      type: 'ReceivedCallback',
      phone: '120363019502934028',
      instanceId: 'test-instance',
      messageId: 'group-msg-1',
      fromMe: false,
      isGroup: true,
      participantPhone: '5511988888888',
      chatName: 'Troca: A e B',
      text: { message: 'oi no grupo' },
    });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.findUser).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 silently when payload has participantPhone (defensive guard)', async () => {
    const req = makeReq({
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'test-instance',
      messageId: 'group-msg-2',
      fromMe: false,
      participantPhone: '5511988888888',
      text: { message: 'oi' },
    });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.findUser).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not trigger group guard for a normal phone number', async () => {
    vi.mocked(router.route).mockResolvedValue(ok(undefined));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.findUser).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('error boundary in webhook handler', () => {
  it('sends fallback message and transitions to IDLE when route returns an error', async () => {
    vi.mocked(router.route).mockResolvedValue(err(new Error('handler blew up')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      'Algo deu errado. Use o menu para continuar.'
    );
    expect(usersDb.transitionState).toHaveBeenCalledWith('user-uuid', 'IDLE');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('sends fallback message and transitions to IDLE when route throws synchronously', async () => {
    vi.mocked(router.route).mockImplementation(() => {
      throw new Error('unexpected throw');
    });
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      'Algo deu errado. Use o menu para continuar.'
    );
    expect(usersDb.transitionState).toHaveBeenCalledWith('user-uuid', 'IDLE');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not send fallback when route succeeds', async () => {
    vi.mocked(router.route).mockResolvedValue(ok(undefined));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(zapi.sendText).not.toHaveBeenCalledWith(
      expect.any(String),
      'Algo deu errado. Use o menu para continuar.'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('sends fallback to phone but skips transitionState when user is null', async () => {
    vi.mocked(usersDb.findUser).mockResolvedValue(ok(null));
    vi.mocked(router.route).mockResolvedValue(err(new Error('route error')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(zapi.sendText).toHaveBeenCalledWith(
      '5511999999999',
      'Algo deu errado. Use o menu para continuar.'
    );
    expect(usersDb.transitionState).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still returns 200 even when the fallback sendText itself throws', async () => {
    vi.mocked(router.route).mockResolvedValue(err(new Error('handler error')));
    vi.mocked(zapi.sendText).mockImplementation(() => {
      throw new Error('zapi down');
    });
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    // Must return 200 to Z-API regardless of fallback outcome
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
