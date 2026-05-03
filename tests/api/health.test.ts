import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../../src/db/client.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));
vi.mock('../../src/services/zapi.js', () => ({
  checkZApiConnectivity: vi.fn(),
}));

import handler from '../../api/health.js';
import * as client from '../../src/db/client.js';
import * as zapi from '../../src/services/zapi.js';

function makeSelectChain(error: { message: string } | null): { select: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> } {
  return {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ error }),
  };
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const req = { method: 'GET' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/health', () => {
  it('returns 200 when both Supabase and Z-API are healthy', async () => {
    vi.mocked(client.supabase.from).mockReturnValue(makeSelectChain(null) as never);
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(ok(undefined));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, supabase: 'ok', zapi: 'ok' });
  });

  it('returns 503 when Supabase fails with an error', async () => {
    vi.mocked(client.supabase.from).mockReturnValue(makeSelectChain({ message: 'connection refused' }) as never);
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(ok(undefined));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ ok: false, supabase: 'error', zapi: 'ok' });
  });

  it('returns 503 when Supabase throws an exception', async () => {
    vi.mocked(client.supabase.from).mockImplementation(() => {
      throw new Error('unexpected db error');
    });
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(ok(undefined));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ ok: false, supabase: 'error', zapi: 'ok' });
  });

  it('returns 503 when Z-API check fails', async () => {
    vi.mocked(client.supabase.from).mockReturnValue(makeSelectChain(null) as never);
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(err(new Error('Z-API /connected returned 503')));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ ok: false, supabase: 'ok', zapi: 'error' });
  });

  it('returns 503 with both errors when both checks fail', async () => {
    vi.mocked(client.supabase.from).mockReturnValue(makeSelectChain({ message: 'db down' }) as never);
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(err(new Error('Z-API unreachable')));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ ok: false, supabase: 'error', zapi: 'error' });
  });

  it('still checks Z-API even when Supabase fails (never short-circuits)', async () => {
    vi.mocked(client.supabase.from).mockReturnValue(makeSelectChain({ message: 'db down' }) as never);
    vi.mocked(zapi.checkZApiConnectivity).mockResolvedValue(ok(undefined));
    const res = makeRes();

    await handler(req as never, res as never);

    expect(zapi.checkZApiConnectivity).toHaveBeenCalled();
  });
});
