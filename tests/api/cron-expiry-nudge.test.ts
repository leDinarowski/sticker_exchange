import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/listings.js', () => ({
  getUsersNeedingNudge: vi.fn(),
}));
vi.mock('../../src/handlers/confirming-inventory.js', () => ({
  sendExpiryNudge: vi.fn(),
}));

import handler from '../../api/cron-expiry-nudge.js';
import * as listingsDb from '../../src/db/listings.js';
import * as inventory from '../../src/handlers/confirming-inventory.js';

function makeReq(opts: {
  method?: string;
  authHeader?: string;
} = {}): { method: string; headers: Record<string, string> } {
  return {
    method: opts.method ?? 'POST',
    headers: { authorization: opts.authHeader ?? 'Bearer test-secret' },
  };
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['CRON_SECRET'] = 'test-secret';
});

describe('cron-expiry-nudge handler', () => {
  it('returns 405 for non-POST methods', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(listingsDb.getUsersNeedingNudge).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = { method: 'POST', headers: {} };
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(listingsDb.getUsersNeedingNudge).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header has wrong secret', async () => {
    const req = makeReq({ authHeader: 'Bearer wrong-secret' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(listingsDb.getUsersNeedingNudge).not.toHaveBeenCalled();
  });

  it('returns 500 when getUsersNeedingNudge fails', async () => {
    vi.mocked(listingsDb.getUsersNeedingNudge).mockResolvedValue(err(new Error('db error')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(inventory.sendExpiryNudge).not.toHaveBeenCalled();
  });

  it('sends nudge to each target and returns counts', async () => {
    vi.mocked(listingsDb.getUsersNeedingNudge).mockResolvedValue(ok([
      { user_id: 'uuid-1', phone: '5511111111111' },
      { user_id: 'uuid-2', phone: '5522222222222' },
    ]));
    vi.mocked(inventory.sendExpiryNudge).mockResolvedValue(ok(undefined));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 2, failed: 0 });
    expect(inventory.sendExpiryNudge).toHaveBeenCalledTimes(2);
    expect(inventory.sendExpiryNudge).toHaveBeenCalledWith({ id: 'uuid-1', phone: '5511111111111' });
    expect(inventory.sendExpiryNudge).toHaveBeenCalledWith({ id: 'uuid-2', phone: '5522222222222' });
  });

  it('counts failed nudges separately without aborting the loop', async () => {
    vi.mocked(listingsDb.getUsersNeedingNudge).mockResolvedValue(ok([
      { user_id: 'uuid-1', phone: '5511111111111' },
      { user_id: 'uuid-2', phone: '5522222222222' },
      { user_id: 'uuid-3', phone: '5533333333333' },
    ]));
    vi.mocked(inventory.sendExpiryNudge)
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err(new Error('zapi timeout')))
      .mockResolvedValueOnce(ok(undefined));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 2, failed: 1 });
  });

  it('returns sent:0 failed:0 when no targets need nudge', async () => {
    vi.mocked(listingsDb.getUsersNeedingNudge).mockResolvedValue(ok([]));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 0, failed: 0 });
    expect(inventory.sendExpiryNudge).not.toHaveBeenCalled();
  });
});
