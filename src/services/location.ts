import { ok, err, Result } from 'neverthrow';
import { latLngToCell, cellToLatLng } from 'h3-js';
import { supabase } from '../db/client.js';
import { logger } from '../utils/logger.js';

const H3_RESOLUTION = 8;

export async function saveUserLocation(
  userId: string,
  lat: number,
  lng: number
): Promise<Result<void, Error>> {
  const cell = latLngToCell(lat, lng, H3_RESOLUTION);
  const [snappedLat, snappedLng] = cellToLatLng(cell);

  logger.info({ userId, event: 'location_updated', h3Cell: cell });

  const { error } = await supabase.rpc('update_user_location', {
    p_user_id: userId,
    p_lat: snappedLat,
    p_lng: snappedLng,
  });

  if (error) return err(new Error(error.message));
  return ok(undefined);
}
