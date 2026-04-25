import { ok, err, Result } from 'neverthrow';
import { supabase } from './client.js';
import {
  User,
  ConversationStep,
  ConversationStateContext,
  ConversationStatePayload,
} from '../types/index.js';

export interface UserIdentifier {
  phone?: string;
  waUsername?: string;
}

export async function findUser(
  id: UserIdentifier
): Promise<Result<User | null, Error>> {
  const { phone, waUsername } = id;

  let query = supabase.from('users').select('*');

  if (phone && waUsername) {
    query = query.or(`phone.eq.${phone},wa_username.eq.${waUsername}`);
  } else if (phone) {
    query = query.eq('phone', phone);
  } else if (waUsername) {
    query = query.eq('wa_username', waUsername);
  } else {
    return ok(null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) return err(new Error(error.message));
  return ok(data as User | null);
}

export async function createUser(
  id: UserIdentifier
): Promise<Result<User, Error>> {
  const now = new Date().toISOString();
  const initialState: ConversationStatePayload = {
    step: ConversationStep.NEW,
    context: {},
    updated_at: now,
  };

  const insert: Record<string, unknown> = {
    conversation_state: initialState,
  };
  if (id.phone) insert['phone'] = id.phone;
  if (id.waUsername) insert['wa_username'] = id.waUsername;

  const { data, error } = await supabase
    .from('users')
    .insert(insert)
    .select()
    .single();

  if (error) return err(new Error(error.message));
  return ok(data as User);
}

export async function transitionState(
  userId: string,
  newStep: ConversationStep,
  context: ConversationStateContext = {}
): Promise<Result<void, Error>> {
  const payload: ConversationStatePayload = {
    step: newStep,
    context,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('users')
    .update({ conversation_state: payload })
    .eq('id', userId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}

export async function updateUserName(
  userId: string,
  name: string
): Promise<Result<void, Error>> {
  const { error } = await supabase
    .from('users')
    .update({ name })
    .eq('id', userId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}

export async function recordConsent(
  userId: string
): Promise<Result<void, Error>> {
  const { error } = await supabase
    .from('users')
    .update({ consented_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}

export async function recordRefusal(
  userId: string
): Promise<Result<void, Error>> {
  const { error } = await supabase
    .from('users')
    .update({ refused_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}

export async function updateUserRadius(
  userId: string,
  radiusKm: number
): Promise<Result<void, Error>> {
  const { error } = await supabase
    .from('users')
    .update({ radius_km: radiusKm })
    .eq('id', userId);

  if (error) return err(new Error(error.message));
  return ok(undefined);
}
