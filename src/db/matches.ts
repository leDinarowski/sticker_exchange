import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import { Match, MatchStatus } from '../types/index.js';

export async function createMatch(
  userAId: string,
  userBId: string
): Promise<Result<Match, Error>> {
  const { data, error } = await supabase
    .from('matches')
    .insert({ user_a_id: userAId, user_b_id: userBId })
    .select()
    .single();

  if (error) return err(new Error(error.message));
  return ok(data as Match);
}

export async function getMatchById(
  matchId: string
): Promise<Result<Match | null, Error>> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();

  if (error) return err(new Error(error.message));
  return ok(data as Match | null);
}

export async function updateMatchStatus(
  matchId: string,
  status: MatchStatus
): Promise<Result<void, Error>> {
  const { error } = await supabase
    .from('matches')
    .update({ status })
    .eq('id', matchId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}

export async function getPendingMatchesForUserA(
  userId: string
): Promise<Result<Match[], Error>> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('user_a_id', userId)
    .eq('status', 'PENDING');

  if (error) return err(new Error(error.message));
  return ok((data ?? []) as Match[]);
}
