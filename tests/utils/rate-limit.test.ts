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
  vi.mocked(router.route).mockResolvedValue(ok(undefined));
});

describe('rate limiting in webhook handler', () => {
  it('allows message when checkRateLimit returns ok(true)', async () => {
    vi.mocked(usersDb.checkRateLimit).mockResolvedValue(ok(true));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(router.route).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('silently drops message when checkRateLimit returns ok(false)', async () => {
    vi.mocked(usersDb.checkRateLimit).mockResolvedValue(ok(false));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(router.route).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('fails open when checkRateLimit returns an error', async () => {
    vi.mocked(usersDb.checkRateLimit).mockResolvedValue(err(new Error('rpc failed')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    // Fail open: route is still called despite the RPC error
    expect(router.route).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not call checkRateLimit for fromMe messages', async () => {
    const req = makeReq({ ...VALID_PAYLOAD, fromMe: true });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.checkRateLimit).not.toHaveBeenCalled();
  });

  it('does not call checkRateLimit when user is null (new user)', async () => {
    vi.mocked(usersDb.findUser).mockResolvedValue(ok(null));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(usersDb.checkRateLimit).not.toHaveBeenCalled();
  });
});
