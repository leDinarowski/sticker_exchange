# Architecture — sticker_exchange

## Goals

1. Validate location-based P2P matching over WhatsApp with near-zero operational cost.
2. Keep the core engine generic enough to be reused for any domain beyond stickers.
3. Serverless-first: no managed servers, no 24/7 processes outside of what is strictly necessary.

---

## Component Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        User's WhatsApp                           │
└─────────────────────────────┬────────────────────────────────────┘
                              │  Messages, button replies, location
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Z-API  (managed SaaS)                         │
│  - Manages WhatsApp session (no QR handling on our side)         │
│  - Exposes REST endpoints to send messages, buttons, groups      │
│  - Fires HTTP webhooks on incoming messages → Vercel             │
└──────────┬───────────────────────────────────────┬───────────────┘
           │ Webhook POST                          │ REST calls
           ▼                                       │
┌──────────────────────────┐                       │
│     Vercel (Serverless)  │◄──────────────────────┘
│                          │
│  /api/webhook            │  ← receives all WA events
│    └─ router             │    routes by message type + state
│        ├─ onboarding     │
│        ├─ listing-update │
│        ├─ location       │
│        ├─ discovery      │
│        ├─ matching       │
│        └─ connection     │
└──────────┬───────────────┘
           │ Read/Write (via connection pooler)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Supabase (PostgreSQL + PostGIS)               │
│                                                                  │
│  users                                                           │
│  ─────────────────────────────────────────────────────────────  │
│  id UUID PK | phone TEXT UNIQUE | wa_username TEXT              │
│  name TEXT | location GEOMETRY(Point,4326) | radius_km INT      │
│  conversation_state JSONB | consented_at TIMESTAMPTZ            │
│  created_at TIMESTAMPTZ                                          │
│                                                                  │
│  listings                        wanted_listings                 │
│  ──────────────────────          ──────────────────────         │
│  id UUID PK                      id UUID PK                     │
│  user_id UUID FK                 user_id UUID FK                │
│  domain TEXT  (e.g.'sticker')    domain TEXT                    │
│  payload JSONB ({code:"BRA5"})   payload JSONB ({code:"BRA5"})    │
│  expires_at TIMESTAMPTZ          created_at TIMESTAMPTZ         │
│  created_at TIMESTAMPTZ                                          │
│                                                                  │
│  matches                                                         │
│  ─────────────────────────────────────────────────────────────  │
│  id UUID PK | user_a_id UUID FK | user_b_id UUID FK            │
│  status ENUM (PENDING|CONFIRMED_A|CONFIRMED_B|CONNECTED|DECLINED│
│            |EXPIRED)                                             │
│  created_at TIMESTAMPTZ | expires_at TIMESTAMPTZ                │
│                                                                  │
│  Indexes:                                                        │
│  - GIST index on users.location                                  │
│  - B-tree on listings.user_id, listings.expires_at              │
│  - B-tree on wanted_listings.user_id                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Location Privacy Pipeline

All location data passes through a privacy transformation before storage:

```
WhatsApp location message:
  { latitude: -23.55051, longitude: -46.63382 }   ← exact GPS

Step 1 — H3 snapping (h3-js, resolution 8, ~460m hex):
  h3.cellToLatLng(h3.latLngToCell(lat, lng, 8))
  → { lat: -23.5520, lng: -46.6350 }              ← neighborhood-level only

Step 2 — PostGIS geometry storage:
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)         ← stored as GEOMETRY

Step 3 — Query output:
  ST_Distance(...) → distance in meters            ← never coordinates
```

Exact coordinates are never stored, logged, or returned to any client.

---

## Data Flow — Onboarding

```
Any message from unknown number
→ Webhook → Router: user not found → state = NEW
→ Send welcome + ask for name  (button: [Comecar])

User taps Comecar or sends name
→ state = ONBOARDING_NAME → validate → save name
→ Send terms message  (buttons: [Aceito] [Recuso])

User taps Aceito
→ Record consented_at = NOW()
→ state = ONBOARDING_TERMS → ask for location share

User shares WhatsApp location
→ state = ONBOARDING_LOCATION
→ H3-snap coords → store geometry
→ Ask for radius  (buttons: [1 km] [3 km] [5 km] [7 km])

User taps radius
→ state = ONBOARDING_RADIUS → save radius_km
→ Ask for listing numbers (explain range syntax)

User sends listing (e.g. "BRA5, ARG3, FWC8 ou BRA5-10")
→ state = ONBOARDING_LISTINGS → parse → echo back for confirmation
→ (buttons: [Confirmar] [Corrigir])

User confirms
→ Insert listings rows → expires_at = NOW() + 24h
→ state = IDLE → show main menu
```

---

## Data Flow — Main Menu (IDLE)

```
User in IDLE state (any message or button reply)
→ Show main menu with buttons:
    [Olhar em Volta]
    [Match Perfeito]
    [Atualizar Figurinhas]
    [Atualizar Localizacao]
```

---

## Data Flow — Discovery (Olhar em Volta)

```
User taps [Olhar em Volta]
→ state = BROWSING

Geospatial query:
  SELECT u.id, u.name,
         array_agg(l.payload->>'code') AS items,
         ST_Distance(u.location::geography, $myLocation::geography) AS dist_m
  FROM users u
  JOIN listings l ON l.user_id = u.id
    AND l.expires_at > NOW()
    AND l.domain = 'sticker'
  WHERE ST_DWithin(u.location::geography, $myLocation::geography, $radius_m)
    AND u.id != $myUserId
  GROUP BY u.id
  ORDER BY dist_m ASC
  LIMIT 10

→ Format as numbered list, save in conversation_state.context.discovery_list
→ User selects by number → connection flow
```

---

## Data Flow — Bilateral Match (Match Perfeito)

```
User taps [Match Perfeito]
→ state = BROWSING (match mode)

Query: users nearby who HAVE items I WANT AND WANT items I HAVE:
  SELECT u.id, u.name, ... (bilateral JOIN on listings x wanted_listings)

→ Surface as numbered list, same selection flow as discovery
```

---

## Data Flow — Connection Flow

```
User A selects User B
→ Insert match row (status = PENDING)
→ Bot to User A: "Aguardando confirmacao de {nome B}..."
→ Bot to User B: "{nome A} quer trocar com voce. Aceita?"
   (buttons: [Sim] [Nao])

User B taps [Sim]
→ Update match status = CONFIRMED_B
→ Z-API: create WhatsApp group with both users
→ Bot welcome message in group
→ Update match status = CONNECTED
→ Both users receive group link
→ Both users prompted: [Atualizar Figurinhas] (inventory may have changed)

User B taps [Nao] or no response in 24h
→ Update match status = DECLINED or EXPIRED
→ Notify User A gracefully
→ Both users return to IDLE
```

---

## Data Flow — Inventory Pre-Expiry Confirmation

```
At 20h after listing creation (pg_cron or scheduled job):
→ Bot to user:
  "Suas figurinhas ainda estao disponiveis?
   [Sim, ainda tenho]  [Atualizar Figurinhas]  [Nao tenho mais]"
→ state = CONFIRMING_INVENTORY

User taps [Sim, ainda tenho]
→ Reset expires_at = NOW() + 24h → state = IDLE

User taps [Atualizar Figurinhas]
→ state = ONBOARDING_LISTINGS (re-entry)
→ Show current list → ask for updated list (supports ranges + differential)

User taps [Nao tenho mais]
→ Delete all listings for user → state = IDLE
→ "Suas figurinhas foram removidas. Use o menu para adicionar novas."

No response in 4h
→ Listings expire (expires_at passes) → user removed from discovery board
→ No action — user is passively removed
```

---

## Infrastructure Cost Estimate (MVP)

| Service | Tier | Monthly Cost |
|---|---|---|
| Vercel | Hobby (free) | $0 |
| Supabase | Free tier (500MB DB, 2GB bandwidth) | $0 |
| Z-API | Starter plan | ~R$69/month |
| **Total** | | **~R$69/month** |

Upgrade triggers: Vercel Pro ($20/month) if function timeouts appear in production. Supabase Pro if DB exceeds 500MB.

---

## Future Extensibility

The engine is domain-agnostic. To adapt for a new use case (e.g., service exchange, local marketplace):
1. Add a new `domain` value and define its `payload` schema.
2. Adapt conversation handlers for the new onboarding flow.
3. The geospatial query, state machine, connection flow, and privacy pipeline remain unchanged.
