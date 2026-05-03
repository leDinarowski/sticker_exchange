import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import { DiscoveryUser } from '../types/index.js';

export async function getUsersAwaitingDiscovery(): Promise<Result<DiscoveryUser[], Error>> {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, conversation_state')
    .filter('conversation_state->>step', 'eq', 'AWAITING_DISCOVERY');

  if (error) return err(new Error(error.message));
  return ok((data ?? []) as DiscoveryUser[]);
}
