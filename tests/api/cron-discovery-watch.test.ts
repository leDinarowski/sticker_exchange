import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/discovery-watch.js', () => ({
  getUsersAwaitingDiscovery: vi.fn(),
}));
vi.mock('../../src/handlers/awaiting-discovery.js', () => ({
  processDiscoveryWatch: vi.fn(),
}));

import handler from '../../api/cron-discovery-watch.js';
import * as discoveryWatch from '../../src/db/discovery-watch.js';
import * as awaitingDiscovery from '../../src/handlers/awaiting-discovery.js';

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
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['CRON_SECRET'] = 'test-secret';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cron-discovery-watch handler', () => {
  it('returns 405 for non-POST methods', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(discoveryWatch.getUsersAwaitingDiscovery).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = { method: 'POST', headers: {} };
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(discoveryWatch.getUsersAwaitingDiscovery).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header has wrong secret', async () => {
    const req = makeReq({ authHeader: 'Bearer wrong-secret' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(discoveryWatch.getUsersAwaitingDiscovery).not.toHaveBeenCalled();
  });

  it('skips and returns 200 with skipped:true when outside BRT quiet-hour window', async () => {
    // UTC 05:00 is outside the window (window is hourUTC >= 9 || hourUTC < 1)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T05:00:00Z'));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skipped: true }));
    expect(discoveryWatch.getUsersAwaitingDiscovery).not.toHaveBeenCalled();
  });

  it('returns 500 when getUsersAwaitingDiscovery fails', async () => {
    vi.mocked(discoveryWatch.getUsersAwaitingDiscovery).mockResolvedValue(
      err(new Error('db error'))
    );
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(awaitingDiscovery.processDiscoveryWatch).not.toHaveBeenCalled();
  });

  it('returns notified/exhausted/failed counts on success', async () => {
    vi.mocked(discoveryWatch.getUsersAwaitingDiscovery).mockResolvedValue(
      ok([
        { id: 'uuid-1', phone: '5511111111111', conversation_state: null },
        { id: 'uuid-2', phone: '5522222222222', conversation_state: null },
        { id: 'uuid-3', phone: '5533333333333', conversation_state: null },
      ])
    );
    vi.mocked(awaitingDiscovery.processDiscoveryWatch)
      .mockResolvedValueOnce(ok('notified'))
      .mockResolvedValueOnce(ok('exhausted'))
      .mockResolvedValueOnce(ok('notified'));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notified: 2, exhausted: 1, failed: 0 });
    expect(awaitingDiscovery.processDiscoveryWatch).toHaveBeenCalledTimes(3);
  });

  it('counts per-user failures without aborting the loop', async () => {
    vi.mocked(discoveryWatch.getUsersAwaitingDiscovery).mockResolvedValue(
      ok([
        { id: 'uuid-1', phone: '5511111111111', conversation_state: null },
        { id: 'uuid-2', phone: '5522222222222', conversation_state: null },
        { id: 'uuid-3', phone: '5533333333333', conversation_state: null },
      ])
    );
    vi.mocked(awaitingDiscovery.processDiscoveryWatch)
      .mockResolvedValueOnce(ok('notified'))
      .mockResolvedValueOnce(err(new Error('zapi timeout')))
      .mockResolvedValueOnce(ok('exhausted'));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notified: 1, exhausted: 1, failed: 1 });
    expect(awaitingDiscovery.processDiscoveryWatch).toHaveBeenCalledTimes(3);
  });
});
