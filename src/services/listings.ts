import { ok, err, Result } from 'neverthrow';
import { supabase } from '../db/client.js';
import { ParseResult } from '../utils/listing-parser.js';

export async function applyListingUpdate(
  userId: string,
  domain: string,
  result: ParseResult
): Promise<Result<void, Error>> {
  switch (result.op) {
    case 'set': {
      const { error: deleteError } = await supabase
        .from('listings')
        .delete()
        .eq('user_id', userId)
        .eq('domain', domain);
      if (deleteError) return err(new Error(deleteError.message));
      return insertListings(userId, domain, result.codes);
    }

    case 'add':
      return insertListings(userId, domain, result.codes);

    case 'remove': {
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('user_id', userId)
        .eq('domain', domain)
        .in('payload->>code', result.codes);
      return error ? err(new Error(error.message)) : ok(undefined);
    }
  }
}

async function insertListings(
  userId: string,
  domain: string,
  codes: string[]
): Promise<Result<void, Error>> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const rows = codes.map(code => ({
    user_id: userId,
    domain,
    payload: { code },
    expires_at: expiresAt,
  }));

  const { error } = await supabase.from('listings').upsert(rows, {
    onConflict: 'user_id,domain,payload',
  });

  return error ? err(new Error(error.message)) : ok(undefined);
}
