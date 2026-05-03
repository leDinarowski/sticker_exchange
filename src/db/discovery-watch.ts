import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import { User } from '../types/index.js';

export async function getUsersAwaitingDiscovery(): Promise<Result<User[], Error>> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .filter('conversation_state->>step', 'eq', 'AWAITING_DISCOVERY');

  if (error) return err(new Error(error.message));
  return ok((data ?? []) as User[]);
}
