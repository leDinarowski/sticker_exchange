import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/listings.js', () => ({
  getUsersForLocationNudge: vi.fn(),
}));
vi.mock('../../src/db/users.js', () => ({
  markLocationNudgeSent: vi.fn(),
}));
vi.mock('../../src/services/zapi.js', () => ({
  sendText: vi.fn(),
}));

import handler from '../../api/cron-location-nudge.js';
import * as listingsDb from '../../src/db/listings.js';
import * as usersDb from '../../src/db/users.js';
import * as zapi from '../../src/services/zapi.js';

function makeReq(opts: { method?: string; authHeader?: string } = {}): { method: string; headers: Record<string, string> } {
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
  vi.mocked(usersDb.markLocationNudgeSent).mockResolvedValue(ok(undefined));
});

describe('cron-location-nudge handler', () => {
  it('returns 405 for non-POST methods', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(listingsDb.getUsersForLocationNudge).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = { method: 'POST', headers: {} };
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(listingsDb.getUsersForLocationNudge).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header has wrong secret', async () => {
    const req = makeReq({ authHeader: 'Bearer wrong-secret' });
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(listingsDb.getUsersForLocationNudge).not.toHaveBeenCalled();
  });

  it('returns 500 when getUsersForLocationNudge fails', async () => {
    vi.mocked(listingsDb.getUsersForLocationNudge).mockResolvedValue(err(new Error('db error')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(zapi.sendText).not.toHaveBeenCalled();
  });

  it('returns sent:0 failed:0 and does not mark nudge when no targets', async () => {
    vi.mocked(listingsDb.getUsersForLocationNudge).mockResolvedValue(ok([]));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 0, failed: 0 });
    expect(usersDb.markLocationNudgeSent).not.toHaveBeenCalled();
  });

  it('sends nudge to each target and resets 7-day clock', async () => {
    vi.mocked(listingsDb.getUsersForLocationNudge).mockResolvedValue(ok([
      { user_id: 'uuid-1', phone: '5511111111111' },
      { user_id: 'uuid-2', phone: '5522222222222' },
    ]));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 2, failed: 0 });
    expect(zapi.sendText).toHaveBeenCalledTimes(2);
    expect(usersDb.markLocationNudgeSent).toHaveBeenCalledWith('uuid-1');
    expect(usersDb.markLocationNudgeSent).toHaveBeenCalledWith('uuid-2');
  });

  it('counts send failures separately and does not call markLocationNudgeSent for failed sends', async () => {
    vi.mocked(listingsDb.getUsersForLocationNudge).mockResolvedValue(ok([
      { user_id: 'uuid-1', phone: '5511111111111' },
      { user_id: 'uuid-2', phone: '5522222222222' },
    ]));
    vi.mocked(zapi.sendText)
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err(new Error('zapi timeout')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: 1, failed: 1 });
    expect(usersDb.markLocationNudgeSent).toHaveBeenCalledTimes(1);
    expect(usersDb.markLocationNudgeSent).toHaveBeenCalledWith('uuid-1');
    expect(usersDb.markLocationNudgeSent).not.toHaveBeenCalledWith('uuid-2');
  });

  it('does not count as failure when markLocationNudgeSent errors (nudge was delivered)', async () => {
    vi.mocked(listingsDb.getUsersForLocationNudge).mockResolvedValue(ok([
      { user_id: 'uuid-1', phone: '5511111111111' },
    ]));
    vi.mocked(zapi.sendText).mockResolvedValue(ok(undefined));
    vi.mocked(usersDb.markLocationNudgeSent).mockResolvedValue(err(new Error('db write failed')));
    const req = makeReq();
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    // sent still counts as 1 — mark failure is non-fatal
    expect(res.json).toHaveBeenCalledWith({ sent: 1, failed: 0 });
  });
});
