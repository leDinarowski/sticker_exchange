import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';

export async function getUserActiveListingsCount(
  userId: string,
  domain: string
): Promise<Result<number, Error>> {
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('domain', domain)
    .gt('expires_at', new Date().toISOString());

  if (error) return err(new Error(error.message));
  return ok(count ?? 0);
}

export interface NudgeTarget {
  user_id: string;
  phone: string;
}

export async function getUsersNeedingNudge(): Promise<Result<NudgeTarget[], Error>> {
  const { data, error } = await supabase.rpc('get_users_needing_expiry_nudge');
  if (error) return err(new Error(error.message));
  return ok((data ?? []) as NudgeTarget[]);
}
