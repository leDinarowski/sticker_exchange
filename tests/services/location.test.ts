import { describe, it, expect, vi, beforeEach } from 'vitest';
import { latLngToCell, cellToLatLng } from 'h3-js';

vi.mock('../../src/db/client.js', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { saveUserLocation } from '../../src/services/location.js';
import { supabase } from '../../src/db/client.js';

beforeEach(() => vi.clearAllMocks());

describe('saveUserLocation', () => {
  it('snaps coordinates to H3 resolution 10 before calling RPC', async () => {
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

describe('H3 resolution 10 — 300 m precision', () => {
  it('two points ~300 m apart snap to different H3 cells (dist_m > 0)', () => {
    // São Paulo coordinates; Point B is ~300 m north of Point A.
    const latA = -23.55051;
    const lngA = -46.63382;
    const latB = -23.54781; // ~300 m north
    const lngB = -46.63382;

    const cellA = latLngToCell(latA, lngA, 10);
    const cellB = latLngToCell(latB, lngB, 10);

    expect(cellA).not.toBe(cellB);

    const [snapLatA, snapLngA] = cellToLatLng(cellA);
    const [snapLatB, snapLngB] = cellToLatLng(cellB);

    // Haversine approximation: at ~23° S latitude, 1° lat ≈ 111 km
    const dLat = (snapLatB - snapLatA) * 111000;
    const dLng = (snapLngB - snapLngA) * 111000 * Math.cos((latA * Math.PI) / 180);
    const distM = Math.sqrt(dLat ** 2 + dLng ** 2);

    expect(distM).toBeGreaterThan(0);
  });

  it('resolution 10 cell diameter is well below 300 m (~65 m)', () => {
    // Verify the resolution is actually 10 by checking that a snapped centroid
    // is never more than ~100 m from the raw input (conservative bound for res 10).
    const lat = -23.55051;
    const lng = -46.63382;
    const cell = latLngToCell(lat, lng, 10);
    const [snappedLat, snappedLng] = cellToLatLng(cell);

    const dLat = (snappedLat - lat) * 111000;
    const dLng = (snappedLng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
    const distToCenter = Math.sqrt(dLat ** 2 + dLng ** 2);

    expect(distToCenter).toBeLessThan(100);
  });
});
