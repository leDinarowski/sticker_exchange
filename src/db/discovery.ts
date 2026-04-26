import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import { DiscoveryEntry } from '../types/index.js';

interface NearbyUserRow {
  user_id: string;
  name: string;
  items: Array<{ code: string }>;
  dist_m: number;
}

export async function findNearbyUsers(
  userId: string,
  domain = 'sticker'
): Promise<Result<DiscoveryEntry[], Error>> {
  const { data, error } = await supabase.rpc('find_nearby_users_for', {
    p_user_id: userId,
    p_domain: domain,
  });

  if (error) return err(new Error(error.message));

  const rows = (data ?? []) as NearbyUserRow[];
  const entries: DiscoveryEntry[] = rows.map((row, i) => ({
    rank: i + 1,
    user_id: row.user_id,
    name: row.name,
    items: row.items.map((item) => item.code),
    dist_m: row.dist_m,
  }));

  return ok(entries);
}
