---
name: lgpd
description: "Use this skill whenever writing code or flows that touch user personal data: onboarding consent, location storage, match creation, group creation, data deletion, or logging. Covers LGPD compliance requirements specific to this project, PII fields, consent recording, and the bilateral consent flow."
---

# LGPD Compliance — sticker_exchange

## PII Fields in This Project

| Field | Table | Classification | Rule |
|---|---|---|---|
| `phone` | users | Sensitive PII | Never log, never expose in API responses |
| `wa_username` | users | Sensitive PII | Same as phone |
| `name` | users | PII | Can appear in messages to matched users; never in logs |
| `location` | users | Sensitive PII | H3-snap before storage; never return coordinates; never log |
| `conversation_state` | users | May contain PII (name in context) | Never log the full JSONB blob |

---

## Consent Recording (Mandatory Before Any Data Storage)

Consent must be recorded **before** the user's name, location, or listings are saved to the database. The consent flow is:

```
1. User sends first message (any content)
2. Bot: welcome message + terms explanation
3. User taps [Aceito]
4. Bot handler records: consented_at = NOW(), data_processing_agreed = true
5. ONLY THEN proceed to collect name, location, listings
```

If the user taps [Recuso]:
```typescript
await supabase.from('users').update({
  refused_at: new Date().toISOString(),
  data_processing_agreed: false,
}).eq('id', user.id);

await zapi.sendText({
  phone: user.phone,
  message: 'Entendido. Nenhum dado sera armazenado. Se mudar de ideia, envie qualquer mensagem.',
});
// Stop processing all future messages from this user
```

Never store name, location, or listings for a user whose `consented_at` is null.

---

## Bilateral Consent Before Group Creation

Creating a WhatsApp group exposes both users to each other. Both must consent:

```
User A selects User B from discovery board
→ Insert match (status = PENDING)
→ Notify User A: waiting for confirmation from User B
→ Notify User B: "[Nome A] quer trocar com voce. Aceita criar um grupo?"
   Buttons: [Sim] [Nao]

Only on BOTH conditions true:
  - User A already consented (they initiated the selection)
  - User B taps [Sim]

→ Create group → update match status = CONNECTED
```

Never create a group before User B's explicit button tap. A timeout (no response in 24h) counts as implicit refusal — do not create the group.

---

## Logging Rules

```typescript
// WRONG — logs PII
logger.info({ phone: user.phone, name: user.name, event: 'user_found' });

// CORRECT — use internal UUID only
logger.info({ userId: user.id, event: 'user_found' });

// WRONG — logs location
logger.info({ location: user.location, event: 'location_updated' });

// CORRECT — log only the H3 cell ID (not the coordinates)
const cell = latLngToCell(lat, lng, 8);
logger.info({ userId: user.id, event: 'location_updated', h3Cell: cell });

// WRONG — logs raw webhook payload (contains phone number)
logger.info({ payload: webhookPayload });

// CORRECT — log only what you need
logger.info({ userId: user.id, messageType: payload.message.type, event: 'webhook_received' });
```

---

## Data Deletion (Right to Erasure)

Any user can request deletion via the menu. When processing a deletion request:

```typescript
export async function deleteUser(userId: string): Promise<Result<void, Error>> {
  // listings and wanted_listings cascade via FK ON DELETE CASCADE
  // matches: anonymize rather than delete (preserve aggregate stats)
  await supabase.from('matches').update({
    user_a_id: null,
    user_b_id: null,
  }).or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

  const { error } = await supabase.from('users').delete().eq('id', userId);
  return error ? err(new Error(error.message)) : ok(undefined);
}
```

The match row is anonymized (user IDs nulled) rather than deleted to preserve aggregate counts (total connections made). No PII remains after nulling.

---

## Compliance Checklist (Run Before Any PR That Touches User Data)

- [ ] No PII appears in any `logger.info/warn/error` call
- [ ] No raw coordinates returned from any API route or Supabase RPC
- [ ] `consented_at` is set before name/location/listings are written
- [ ] Refusal path stores `refused_at` and stops processing
- [ ] Group is only created after both users have given explicit button consent
- [ ] User deletion removes all PII and cascades to listings
- [ ] `wa_username` treated with same care as `phone` throughout
- [ ] Webhook payload is never logged in full (contains phone number)
