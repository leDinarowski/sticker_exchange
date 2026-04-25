import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client.js', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { saveUserLocation } from '../../src/services/location.js';
import { supabase } from '../../src/db/client.js';

beforeEach(() => vi.clearAllMocks());

describe('saveUserLocation', () => {
  it('snaps coordinates to H3 resolution 8 before calling RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    const rawLat = -23.55051;
    const rawLng = -46.63382;

    await saveUserLocation('uuid-1', rawLat, rawLng);

    expect(supabase.rpc).toHaveBeenCalledWith('update_user_location', {
      p_user_id: 'uuid-1',
      p_lat: expect.not.objectContaining({ value: rawLat }),
      p_lng: expect.not.objectContaining({ value: rawLng }),
    });
  });

  it('does not pass raw GPS to the RPC — snapped coords differ from input', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    await saveUserLocation('uuid-1', -23.55051, -46.63382);

    const call = vi.mocked(supabase.rpc).mock.calls[0];
    const args = call?.[1] as { p_lat: number; p_lng: number };

    expect(args?.p_lat).toBeDefined();
    expect(args?.p_lng).toBeDefined();
    expect(args?.p_lat).not.toBeCloseTo(-23.55051, 4);
  });

  it('returns err when RPC fails', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'RPC error' },
    } as never);

    const result = await saveUserLocation('uuid-1', -23.55051, -46.63382);

    expect(result.isErr()).toBe(true);
  });

  it('returns ok on success', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    const result = await saveUserLocation('uuid-1', -23.55, -46.63);

    expect(result.isOk()).toBe(true);
  });
});
