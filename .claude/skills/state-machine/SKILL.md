---
name: state-machine
description: "Use this skill when implementing or extending the conversation state machine: adding new states, reading/writing conversation context, handling state transitions, or testing state logic. Covers the full state enum, JSONB schema, transition rules, and how to add a new handler safely."
---

# Conversation State Machine

## State Enum

```typescript
// src/state/states.ts
export const ConversationState = {
  NEW:                    'NEW',
  ONBOARDING_NAME:        'ONBOARDING_NAME',
  ONBOARDING_TERMS:       'ONBOARDING_TERMS',
  ONBOARDING_LOCATION:    'ONBOARDING_LOCATION',
  ONBOARDING_RADIUS:      'ONBOARDING_RADIUS',
  ONBOARDING_LISTINGS:    'ONBOARDING_LISTINGS',
  IDLE:                   'IDLE',
  BROWSING:               'BROWSING',
  CONFIRMING_INVENTORY:   'CONFIRMING_INVENTORY',
  AWAITING_MATCH_RESPONSE: 'AWAITING_MATCH_RESPONSE',
} as const;

export type ConversationState = typeof ConversationState[keyof typeof ConversationState];
```

---

## JSONB Schema (users.conversation_state)

```typescript
// src/types/state.ts
export interface ConversationStatePayload {
  step: ConversationState;
  context: StateContext;
  updated_at: string; // ISO 8601
}

export interface StateContext {
  // BROWSING
  mode?: 'discovery' | 'bilateral';
  discovery_list?: DiscoveryEntry[];

  // ONBOARDING_LISTINGS (re-entry for update)
  pending_listings?: number[];

  // AWAITING_MATCH_RESPONSE
  pending_match_id?: string;
  pending_target_name?: string;

  // CONFIRMING_INVENTORY
  retry_count?: number;
}

export interface DiscoveryEntry {
  rank: number;
  user_id: string;
  name: string;
  items: number[];
  dist_m: number;
}
```

---

## Reading State

Always read state before processing any message:

```typescript
// src/db/users.ts
export async function getUserByPhone(
  phone: string
): Promise<Result<User | null, Error>> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error && error.code !== 'PGRST116') return err(new Error(error.message));
  return ok(data ?? null);
}
```

If `getUserByPhone` returns `null`, the user is new — route to `NEW` handler regardless of message content.

---

## Writing State Transitions

Always update state atomically with any other changes in the same operation:

```typescript
// src/db/users.ts
export async function transitionState(
  userId: string,
  newStep: ConversationState,
  context: StateContext = {}
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
```

---

## Handler Structure

Each handler receives the user and the incoming webhook payload, performs its logic, transitions state, and sends a WhatsApp message. All handlers follow this shape:

```typescript
// src/handlers/onboarding-name.ts
import { Result, ok, err } from 'neverthrow';
import { User } from '../types/user';
import { WebhookPayload } from '../webhook/schema';
import { transitionState } from '../db/users';
import { zapi } from '../services/zapi';
import { logger } from '../utils/logger';

export async function handleOnboardingName(
  user: User,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  const name = payload.message.text?.message?.trim();

  if (!name || name.length < 2 || name.length > 50) {
    await zapi.sendText({
      phone: user.phone,
      message: 'Por favor, envie seu nome (entre 2 e 50 caracteres).',
    });
    return ok(undefined); // no state transition — re-prompt
  }

  const { error } = await supabase
    .from('users')
    .update({ name })
    .eq('id', user.id);

  if (error) return err(new Error(error.message));

  const stateResult = await transitionState(user.id, 'ONBOARDING_TERMS');
  if (stateResult.isErr()) return err(stateResult.error);

  await zapi.sendButtons({
    phone: user.phone,
    message: 'Seus dados serao usados para encontrar pessoas proximas para troca. Aceita?',
    buttons: [
      { id: 'terms_accept', label: 'Aceito' },
      { id: 'terms_refuse', label: 'Recuso' },
    ],
  });

  logger.info({ userId: user.id, event: 'state_transition', to: 'ONBOARDING_TERMS' });
  return ok(undefined);
}
```

---

## Router Pattern

```typescript
// src/webhook/router.ts
export async function route(
  user: User | null,
  payload: WebhookPayload
): Promise<Result<void, Error>> {
  // New user — any message triggers onboarding
  if (!user) return handleNew(payload);

  const step = user.conversation_state?.step ?? 'NEW';

  // Button reply routing takes priority over state
  if (payload.message.type === 'buttonsResponseMessage') {
    return routeButtonReply(user, payload);
  }

  switch (step) {
    case 'ONBOARDING_NAME':        return handleOnboardingName(user, payload);
    case 'ONBOARDING_TERMS':       return handleOnboardingTerms(user, payload);
    case 'ONBOARDING_LOCATION':    return handleOnboardingLocation(user, payload);
    case 'ONBOARDING_RADIUS':      return handleOnboardingRadius(user, payload);
    case 'ONBOARDING_LISTINGS':    return handleOnboardingListings(user, payload);
    case 'IDLE':                   return showMainMenu(user);
    case 'BROWSING':               return handleBrowsing(user, payload);
    case 'CONFIRMING_INVENTORY':   return handleConfirmingInventory(user, payload);
    case 'AWAITING_MATCH_RESPONSE': return handleAwaitingMatch(user, payload);
    default:
      logger.warn({ userId: user.id, step, event: 'unknown_state' });
      return transitionState(user.id, 'IDLE').andThen(() => showMainMenu(user));
  }
}
```

---

## Rules When Adding a New State

1. Add the state to `ConversationState` enum first.
2. Add any context fields to `StateContext` interface.
3. Create a handler file in `src/handlers/`.
4. Add the case to the router switch.
5. Write unit tests for the handler before any integration work.
6. Always define both the happy path and the fallback (invalid input → re-prompt or IDLE).

---

## Testing State Transitions

```typescript
// tests/handlers/onboarding-name.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleOnboardingName } from '../../src/handlers/onboarding-name';

describe('handleOnboardingName', () => {
  it('saves name and transitions to ONBOARDING_TERMS on valid input', async () => {
    const mockUser = { id: 'uuid', phone: '5511999999999' };
    const mockPayload = buildTextPayload('Joao Silva');

    const transitionSpy = vi.spyOn(db, 'transitionState');
    const zapiSpy = vi.spyOn(zapi, 'sendButtons');

    await handleOnboardingName(mockUser, mockPayload);

    expect(transitionSpy).toHaveBeenCalledWith('uuid', 'ONBOARDING_TERMS');
    expect(zapiSpy).toHaveBeenCalled();
  });

  it('re-prompts without state transition on name shorter than 2 chars', async () => {
    const mockPayload = buildTextPayload('A');
    const transitionSpy = vi.spyOn(db, 'transitionState');

    await handleOnboardingName(mockUser, mockPayload);

    expect(transitionSpy).not.toHaveBeenCalled();
  });
});
```
