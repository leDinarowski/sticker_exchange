---
name: whatsapp-flow
description: "Use this skill when designing or implementing any WhatsApp conversation flow in this project: sending messages, building button menus, designing state transitions, or writing user-facing copy. Covers Z-API call patterns, button message constraints, copy rules, and conversation UX principles."
---

# WhatsApp Conversation Flow

## Core Rules (Non-Negotiable)

- No emojis anywhere in message copy.
- No keyword detection for navigation. Every choice the user makes must be a button.
- Button labels: maximum 20 characters. Direct and action-oriented.
- Body text: 1–2 short sentences. Never explain mechanics — just tell the user what to do.
- Free-text input is only accepted for: name, listing numbers, and WhatsApp location share.

---

## Z-API Call Patterns

All Z-API calls go through `src/services/zapi.ts`. Never call Z-API directly from handlers.

### Send a plain text message

```typescript
await sendText(user.phone, 'Suas figurinhas foram atualizadas.');
```

### Send a button message (up to 3 buttons)

```typescript
await sendButtons(
  user.phone,
  'Suas figurinhas ainda estao disponiveis?',
  [
    { id: 'confirm_inventory', label: 'Sim, ainda tenho' },
    { id: 'update_inventory',  label: 'Atualizar figurinhas' },
    { id: 'clear_inventory',   label: 'Nao tenho mais' },
  ]
);
```

### Send a list message (more than 3 options)

```typescript
await sendList(
  user.phone,
  'O que voce quer fazer?',
  'Ver opcoes',
  [
    {
      title: 'Buscar',
      rows: [
        { id: 'discovery',  title: 'Olhar em Volta', description: 'Ver quem esta perto' },
        { id: 'bilateral',  title: 'Match Perfeito', description: 'Troca exata' },
      ],
    },
    {
      title: 'Gerenciar',
      rows: [
        { id: 'update_listings', title: 'Atualizar Figurinhas' },
        { id: 'update_location', title: 'Atualizar Localizacao' },
      ],
    },
  ]
);
```

### Create a WhatsApp group

```typescript
const groupResult = await createGroup('Troca de Figurinhas', [userA.phone, userB.phone]);
// bot is automatically admin; groupResult.value is the group phone/JID
```

---

## Webhook Payload Structure

Z-API fires a POST to `/api/webhook` for every incoming message. **The payload is flat — all fields are at the top level, not nested in a `message` object.**

```typescript
// Actual schema — src/webhook/schema.ts
const webhookPayloadSchema = z.object({
  type: z.literal('ReceivedCallback'),
  phone: z.string(),          // sender phone number (or group JID with @g.us)
  instanceId: z.string(),
  messageId: z.string().optional(),   // absent in some button-response payloads
  fromMe: z.boolean(),
  text: z.object({ message: z.string() }).optional(),
  buttonsResponseMessage: z.object({
    selectedButtonId: z.string().optional(),  // may be absent — use resolveButtonId()
  }).passthrough().optional(),
  listResponseMessage: z.object({ selectedRowId: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});
```

Always validate the payload with Zod before accessing any field. Group messages are filtered in `api/webhook.ts` after schema validation. The filter checks any of: `phone` ending in `@g.us`, `isGroup === true`, or presence of `participantPhone` — Z-API does not always include the `@g.us` suffix.

---

## Handling Button Replies

**Z-API can return a button click in one of two fields** depending on the endpoint:
- `buttonsResponseMessage.selectedButtonId` — Reply Buttons (`send-button-actions`)
- `listResponseMessage.selectedRowId` — Button List (`send-button-list`)

**Never access these fields directly. Always use `resolveButtonId(payload)` from `src/webhook/router.ts`:**

```typescript
import { resolveButtonId } from '../webhook/router.js';

const buttonId = resolveButtonId(payload);  // checks both fields, returns '' if neither

if (buttonId === 'confirm_inventory') return handleConfirmInventory(user);
if (buttonId === 'update_inventory')  return handleUpdateInventory(user);
if (buttonId === 'clear_inventory')   return handleClearInventory(user);
// always have a text fallback too:
const textInput = payload.text?.message?.trim() ?? '';
if (textInput === '1') return handleConfirmInventory(user);
```

---

## Message Copy Guidelines

Write all copy as if the bot is a direct, helpful person. No filler, no decoration.

| Context | Example |
|---|---|
| Welcome | "Bem-vindo ao sticker_exchange. Qual e o seu nome?" |
| Terms | "Seus dados serao usados para encontrar pessoas proximas para troca. Aceita?" |
| Listing prompt | "Envie os numeros das suas figurinhas duplicadas. Use virgulas ou tracos: 12, 45, 78 ou 12-25." |
| Echo-back | "Entendi estas figurinhas: 12, 45, 78, 203. Esta correto?" |
| Empty board | "Nenhum usuario encontrado no seu raio. Tente um raio maior." |
| Connection request (to B) | "{nome A} quer trocar figurinhas com voce. Aceita?" |
| Group welcome | "Combinado! Este grupo foi criado para voces organizarem a troca." |
| Pre-expiry | "Suas figurinhas ainda estao disponiveis?" |
| After clearing | "Figurinhas removidas. Use o menu para adicionar novas quando quiser." |

---

## State → Message Mapping

| State after handler | Message to send |
|---|---|
| NEW | Welcome + ask name |
| ONBOARDING_NAME | Terms (buttons: Aceito, Recuso) |
| ONBOARDING_TERMS | Ask for location share |
| ONBOARDING_LOCATION | Ask for radius (buttons: 1 km, 3 km, 5 km, 7 km) |
| ONBOARDING_RADIUS | Ask for listings |
| ONBOARDING_LISTINGS | Echo-back + confirm buttons |
| IDLE | Main menu (list message) |
| BROWSING | Numbered discovery/match list |
| CONFIRMING_INVENTORY | Pre-expiry button message |
| AWAITING_MATCH_RESPONSE | "Aguardando confirmacao de {nome}..." |
