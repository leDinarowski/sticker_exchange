# Roadmap — sticker_exchange

This document defines the implementation sequence, phase rationale, and inter-phase dependencies. Each phase must be fully tested before the next begins.

---

## Principles

- No phase starts until all tests from the previous phase pass.
- Each phase produces a working, deployable increment — not partial code.
- Phases map directly to branches in the repository (see `TODO.md` for per-item detail).

---

## Phase 0 — Infrastructure & Scaffolding

**Goal:** A working skeleton that can receive a WhatsApp message and acknowledge it. No business logic.

**Deliverables:**
- TypeScript project with linting, formatting, and Vitest configured
- Supabase schema: `users`, `listings`, `wanted_listings`, `matches` — with GIST index and connection pooler URL set
- Z-API connected to a dedicated test number
- Vercel deployment receiving webhooks from Z-API
- GitHub CI passing on every push

**Done when:** Sending "Oi" to the bot number results in a logged Vercel function invocation and a raw acknowledgement response.

**Estimated effort:** 2–3 days

---

## Phase 1 — Onboarding (US-01)

**Goal:** A new user can complete the full onboarding flow and reach the IDLE state with a name, location, and radius saved.

**Depends on:** Phase 0

**Deliverables:**
- State machine: NEW → ONBOARDING_NAME → ONBOARDING_TERMS → ONBOARDING_LOCATION → ONBOARDING_RADIUS → ONBOARDING_LISTINGS → IDLE
- Button messages at every decision point (terms, radius)
- H3 snapping on location input
- LGPD refusal path (Recuso → stop processing, record `refused_at`)
- Graceful error handling: invalid input at each step → re-prompt, max 3 retries
- Main menu displayed on reaching IDLE

**Done when:** A tester can go from first message to IDLE state using only button taps and minimal text input. Listings are not yet registered here — that is Phase 2.

**Estimated effort:** 3–4 days

---

## Phase 2 — Listing Registration (US-02)

**Goal:** A user in IDLE state can register their sticker listings and have them saved with an expiry.

**Depends on:** Phase 1

**Deliverables:**
- Parser: ranges ("12-25"), comma-separated ("12, 45"), mixed
- Differential parser: "remover 45, 78" / "adicionar 203"
- Validation: domain = 'sticker', code must be a valid team code + number (e.g. BRA1–BRA20), FWC00/FWC1–FWC19, or CC1–CC14 — see `stickers_context.md`
- Deduplication: prevent same number twice for same user
- Echo-back confirmation: bot shows parsed list (buttons: [Confirmar] [Corrigir])
- On confirm: insert listings with `expires_at` = NOW() + 24h → state = IDLE → show main menu

**Done when:** A user can send "12-25, 78" and have it parsed, confirmed, and saved; invalid input is rejected with a re-prompt.

**Estimated effort:** 2 days

---

## Phase 3 — Location & Radius Update (US-03)

**Goal:** A registered user can update their location and search radius at any time from the main menu.

**Depends on:** Phase 1

**Deliverables:**
- Handler: IDLE + [Atualizar Localizacao] → request location share
- On new location: H3-snap → update geometry in DB
- After location update: show radius menu, allow re-selection

**Done when:** A user can share a new location from the main menu and have the discovery board use the updated position immediately.

**Estimated effort:** 1 day

---

## Phase 4 — Discovery Board (US-04 — Olhar em Volta)

**Goal:** A registered user can see nearby people with available listings.

**Depends on:** Phase 2 (users must exist with location + active listings)

**Deliverables:**
- Geospatial query: ST_DWithin + active listings, top 10 by distance
- Numbered list response format with name, distance, listing count
- State transition to BROWSING with discovery_list saved in context
- Empty result handling with radius suggestion

**Done when:** Two users registered in the same area can each see the other in the discovery board.

**Estimated effort:** 2 days

---

## Phase 5 — Bilateral Matching (US-04 — Match Perfeito)

**Goal:** A user who has declared wants can find exact bilateral swap opportunities.

**Depends on:** Phase 4 (same infrastructure, different query)

**Deliverables:**
- `wanted_listings` registration flow (same parser as Phase 2)
- Bilateral SQL query (listings JOIN wanted_listings cross-user)
- BROWSING state in bilateral mode
- "Match Perfeito" label in results

**Done when:** User A (has 12, wants 45) and User B (has 45, wants 12) appear in each other's "Match Perfeito" results.

**Estimated effort:** 2 days

---

## Phase 6 — Connection Flow (US-05)

**Goal:** Two users can initiate and complete a connection, resulting in a WhatsApp group.

**Depends on:** Phase 4 or 5 (user must be in BROWSING state with a discovery_list)

**Deliverables:**
- Selection parsing from BROWSING state
- Match record creation (PENDING → CONFIRMED_B → CONNECTED)
- Notification to User B with consent buttons [Sim] [Nao]
- Z-API group creation on bilateral consent
- Group welcome message
- Decline and timeout (24h) paths
- Post-connection inventory nudge for both users

**Done when:** Two testers can initiate a match, both consent, and a WhatsApp group is created automatically.

**Estimated effort:** 3–4 days

---

## Phase 7 — Inventory Management (US-02 + US-06)

**Goal:** Users can update their listings at any time, and the system handles expiry gracefully.

**Depends on:** Phase 2 (listings system), Phase 6 (post-trade nudge)

**Deliverables:**
- [Atualizar Figurinhas] menu handler: full replace + differential (remover/adicionar)
- Pre-expiry job at 20h: button message [Sim, ainda tenho] [Atualizar Figurinhas] [Nao tenho mais]
- [Nao tenho mais] clears inventory immediately
- CONFIRMING_INVENTORY state with 4h silence → passive expiry

**Done when:** A user's listings expire correctly at 24h, the 20h nudge fires and all three response paths work, and inventory updates via menu function correctly.

**Estimated effort:** 2–3 days

---

## Phase 8 — Operational Hardening

**Goal:** The system is stable enough for a real user test with external testers.

**Depends on:** All previous phases

**Deliverables:**
- Rate limiting: max 10 messages/minute per user
- Error boundary: any unhandled state → friendly fallback + log
- Health check endpoint: `GET /api/health` (Supabase + Z-API connectivity)
- Weekly location nudge (scheduled)
- pg_cron (or GitHub Actions) for daily listing cleanup
- Structured log audit: confirm no PII appears in any log line

**Done when:** The system handles malformed input, unexpected message types, and concurrent users without error, and all logs pass a PII audit.

**Estimated effort:** 2 days

---

## Phase 9 — First Real User Test

**Goal:** 5–10 real users complete the full flow in a controlled test.

**Depends on:** Phase 8

**Activities:**
- Recruit testers from a real sticker-trading context
- Instrument key funnel metrics: onboarding completion rate, discovery engagement, connection rate
- Monitor Z-API for ban signals, Vercel for timeout errors
- Log all dropped sessions and classify the drop reason

**Outcome:** A set of qualitative findings that inform whether to continue, pivot the UX, or change the matching strategy.

---

## Future Phases (Post-Validation)

These phases are not scheduled — they depend on what Phase 7 reveals.

| Phase | Description | Trigger |
|---|---|---|
| Photo OCR | User sends sticker page photo, bot extracts numbers | High drop-off at listing input step |
| Domain adapter | Generic plugin interface for non-sticker domains | Successful validation, new domain identified |
| WhatsApp username | Support @username in addition to phone | WA rolls out username widely in BR |
| H3 resolution 9 | ~174m precision for dense urban use cases | User density justifies it |
| Vercel Pro upgrade | 60s timeout, better cold starts | Timeout errors in production |
| Post-trade review | 1–5 rating after each successful connection | Sufficient connection volume |
