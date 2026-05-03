import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';

export interface MeetingPlace {
  id: string;
  name: string;
  address: string;
  neighborhood: string | null;
  distance_m: number;
}

export async function findNearestMeetingPlace(
  userAId: string,
  userBId: string,
  radiusM = 3000
): Promise<Result<MeetingPlace | null, Error>> {
  const { data, error } = await supabase.rpc('find_nearest_meeting_place_for_users', {
    p_user_a_id: userAId,
    p_user_b_id: userBId,
    p_radius_m: radiusM,
  });
  if (error) return err(new Error(error.message));
  const rows = (data ?? []) as MeetingPlace[];
  return ok(rows[0] ?? null);
}
