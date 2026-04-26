import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import { DiscoveryEntry } from '../types/index.js';

interface NearbyUserRow {
  user_id: string;
  name: string;
  items: Array<{ code: string }>;
  dist_m: number;
}

export async function getWantedListings(
  userId: string,
  domain: string
): Promise<Result<string[], Error>> {
  const { data, error } = await supabase
    .from('wanted_listings')
    .select('payload')
    .eq('user_id', userId)
    .eq('domain', domain);

  if (error) return err(new Error(error.message));

  const codes = (data ?? []).map((r) => (r.payload as { code: string }).code);
  return ok(codes);
}

export async function replaceWantedListings(
  userId: string,
  domain: string,
  codes: string[]
): Promise<Result<void, Error>> {
  const { error: delError } = await supabase
    .from('wanted_listings')
    .delete()
    .eq('user_id', userId)
    .eq('domain', domain);

  if (delError) return err(new Error(delError.message));

  if (codes.length === 0) return ok(undefined);

  const rows = codes.map((code) => ({ user_id: userId, domain, payload: { code } }));
  const { error: insError } = await supabase.from('wanted_listings').insert(rows);
  if (insError) return err(new Error(insError.message));

  return ok(undefined);
}

export async function findBilateralMatches(
  userId: string,
  domain = 'sticker'
): Promise<Result<DiscoveryEntry[], Error>> {
  const { data, error } = await supabase.rpc('find_bilateral_matches_for', {
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
