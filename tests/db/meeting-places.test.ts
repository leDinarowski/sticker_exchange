import { describe, it, expect, vi, beforeEach } from 'vitest';


vi.mock('../../src/db/client.js', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { findNearestMeetingPlace } from '../../src/db/meeting-places.js';
import * as client from '../../src/db/client.js';

const MOCK_PLACE = {
  id: 'place-uuid-1',
  name: 'Cafe Teste',
  address: 'Rua das Flores, 10',
  neighborhood: 'Pinheiros',
  distance_m: 320.5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findNearestMeetingPlace', () => {
  it('returns ok(place) when RPC returns one row', async () => {
    vi.mocked(client.supabase.rpc).mockResolvedValue({ data: [MOCK_PLACE], error: null } as never);

    const result = await findNearestMeetingPlace('uuid-a', 'uuid-b');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(MOCK_PLACE);
    expect(client.supabase.rpc).toHaveBeenCalledWith('find_nearest_meeting_place_for_users', {
      p_user_a_id: 'uuid-a',
      p_user_b_id: 'uuid-b',
      p_radius_m: 3000,
    });
  });

  it('returns ok(null) when RPC returns empty array (no place within radius)', async () => {
    vi.mocked(client.supabase.rpc).mockResolvedValue({ data: [], error: null } as never);

    const result = await findNearestMeetingPlace('uuid-a', 'uuid-b');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns ok(null) when RPC returns null data', async () => {
    vi.mocked(client.supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    const result = await findNearestMeetingPlace('uuid-a', 'uuid-b');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns err when RPC returns an error', async () => {
    vi.mocked(client.supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'function not found' },
    } as never);

    const result = await findNearestMeetingPlace('uuid-a', 'uuid-b');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('function not found');
  });

  it('passes a custom radius when provided', async () => {
    vi.mocked(client.supabase.rpc).mockResolvedValue({ data: [], error: null } as never);

    await findNearestMeetingPlace('uuid-a', 'uuid-b', 1500);

    expect(client.supabase.rpc).toHaveBeenCalledWith('find_nearest_meeting_place_for_users', {
      p_user_a_id: 'uuid-a',
      p_user_b_id: 'uuid-b',
      p_radius_m: 1500,
    });
  });
});
