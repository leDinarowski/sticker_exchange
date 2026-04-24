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

## Phase 1 — Onboarding

**Goal:** A new user can complete the full onboarding flow and reach the IDLE state.

**Depends on:** Phase 0

**Deliverables:**
- State machine: NEW → ONBOARDING_NAME → ONBOARDING_TERMS → ONBOARDING_LOCATION → ONBOARDING_RADIUS → ONBOARDING_LISTINGS → IDLE
- Button messages at every decision point (terms, radius)
- H3 snapping on location input
- LGPD refusal path (Recuso → stop processing)
- Echo-back confirmation for listing input
- Main menu displayed on reaching IDLE

**Done when:** A tester can go from first message to a full profile with listings, using only button taps and minimal text input.

**Estimated effort:** 3–4 days

---

## Phase 2 — Discovery Board (Olhar em Volta)

**Goal:** A registered user can see nearby people with available listings.

**Depends on:** Phase 1 (users must exist with location + listings)

**Deliverables:**
- Geospatial query: ST_DWithin + active listings, top 10 by distance
- Numbered list response format
- State transition to BROWSING with discovery_list saved in context
- Empty result handling with radius suggestion

**Done when:** Two users registered in the same area can each see the other in the discovery board.

**Estimated effort:** 2 days

---

## Phase 3 — Bilateral Matching (Match Perfeito)

**Goal:** A user who has declared wants can find exact bilateral swap opportunities.

**Depends on:** Phase 2 (same infrastructure, different query)

**Deliverables:**
- `wanted_listings` registration flow (same parser as listings)
- Bilateral SQL query (listings JOIN wanted_listings cross-user)
- BROWSING state in bilateral mode
- "Match Perfeito" label in results

**Done when:** User A (has 12, wants 45) and User B (has 45, wants 12) appear in each other's "Match Perfeito" results.

**Estimated effort:** 2 days

---

## Phase 4 — Connection Flow

**Goal:** Two users can initiate and complete a connection, resulting in a WhatsApp group.

**Depends on:** Phase 2 or 3 (user must be in BROWSING state with a discovery_list)

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

## Phase 5 — Inventory Management

**Goal:** Users can update their listings at any time, and the system handles expiry gracefully.

**Depends on:** Phase 1 (listings system), Phase 4 (post-trade nudge)

**Deliverables:**
- [Atualizar Figurinhas] menu handler: full replace + differential (remover/adicionar)
- Pre-expiry job at 20h: button message [Sim, ainda tenho] [Atualizar Figurinhas] [Nao tenho mais]
- [Nao tenho mais] clears inventory immediately
- CONFIRMING_INVENTORY state with 4h silence → passive expiry
- Location update flow ([Atualizar Localizacao] menu handler)

**Done when:** A user's listings expire correctly at 24h, the 20h nudge fires and all three response paths work, and inventory updates via menu function correctly.

**Estimated effort:** 2–3 days

---

## Phase 6 — Operational Hardening

**Goal:** The system is stable enough for a real user test with external testers.

**Depends on:** All previous phases

**Deliverables:**
- Rate limiting: max 10 messages/minute per user
- Error boundary: any unhandled state → friendly fallback + log
- Health check endpoint: `GET /api/health`
- Weekly location nudge (scheduled)
- pg_cron (or GitHub Actions) for daily listing cleanup
- Structured log audit: confirm no PII appears in any log line

**Done when:** The system handles malformed input, unexpected message types, and concurrent users without error, and all logs pass a PII audit.

**Estimated effort:** 2 days

---

## Phase 7 — First Real User Test

**Goal:** 5–10 real users complete the full flow in a controlled test.

**Depends on:** Phase 6

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
