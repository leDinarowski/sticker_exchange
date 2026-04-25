# Backlog — sticker_exchange

**Rules:**
- No new phase starts before all tests in the current phase pass.
- Every item that touches code must have a corresponding test file.
- Items move to `[DONE — date]` when complete, not deleted.
- See `roadmap.md` for sequencing and phase rationale.

---

## Phase 0 — Infrastructure & Scaffolding

- [DONE — 2026-04-24] Initialize TypeScript project (`tsconfig.json`, `package.json`, ESLint) — Prettier not configured yet
- [DONE — 2026-04-24] Set up Vitest for testing
- [DONE — 2026-04-24] Set up Pino logger with structured JSON output
- [DONE — 2026-04-24] Create Supabase project + enable PostGIS extension
- [DONE — 2026-04-24] Write first migration: `users`, `listings`, `wanted_listings`, `matches` tables + GIST index
- [DONE — 2026-04-24] Add `wa_username` nullable column to `users` in first migration
- [DONE — 2026-04-24] Configure Supabase connection pooler — `SUPABASE_DB_POOLER_URL` in `.env.example` + documented in CLAUDE.md
- [DONE — 2026-04-24] Create Vercel project + link to repo + add all env vars (`/api/health` returns 200)
- [DONE — 2026-04-25] Set up Z-API account + connect dedicated WhatsApp number
- [DONE — 2026-04-25] Configure Z-API webhook URL → Vercel `/api/webhook`
- [ ] Smoke test: send any message to bot number, confirm webhook fires and Vercel receives it
- [DONE — 2026-04-24] Set up GitHub repo with branch protection on `main` (require PR + passing CI)
- [DONE — 2026-04-25] Set up GitHub Actions CI: `npm run typecheck && npm run lint && npm test`

---

## Phase 1 — Onboarding (US-01)

**Branch:** `feat/onboarding`

- [ ] Implement conversation state machine (state transitions + JSONB persistence)
- [ ] Router: any message from unknown number → trigger onboarding (state = NEW)
- [ ] Handler: NEW → send welcome message, button: [Comecar]
- [ ] Handler: ONBOARDING_NAME → validate name (2–50 chars), save, send terms (buttons: [Aceito] [Recuso])
- [ ] Handler: ONBOARDING_TERMS → on Aceito: record `consented_at`, ask for location share
- [ ] Handler: ONBOARDING_TERMS → on Recuso: save `refused_at`, stop processing future messages gracefully
- [ ] Handler: ONBOARDING_LOCATION → receive WA location message, H3-snap, save geometry, ask for radius
- [ ] Radius prompt uses button message: [1 km] [3 km] [5 km] [7 km]
- [ ] Handler: ONBOARDING_RADIUS → save `radius_km`, ask for listings
- [ ] Graceful error handling: invalid input at each step → re-prompt, max 3 retries
- [ ] Tests: unit tests for each state transition, mock Z-API calls
- [ ] Tests: integration test for full onboarding sequence

---

## Phase 2 — Listing Registration (US-02)

**Branch:** `feat/listing-registration`

- [ ] Parser: ranges ("12-25"), comma-separated ("12, 45"), mixed
- [ ] Differential parser: "remover 45, 78" / "adicionar 203"
- [ ] Validation: domain = 'sticker', numbers 1–670 only
- [ ] Deduplication: prevent same number twice for same user
- [ ] Echo-back confirmation: bot shows parsed list, buttons: [Confirmar] [Corrigir]
- [ ] On confirm: insert listings, `expires_at` = NOW() + 24h
- [ ] State → IDLE → show main menu
- [ ] Main menu buttons: [Olhar em Volta] [Match Perfeito] [Atualizar Figurinhas] [Atualizar Localizacao]
- [ ] Tests: all parser edge cases, deduplication, expiry assignment

---

## Phase 3 — Location & Radius Update (US-03)

**Branch:** `feat/location`

- [ ] Handler: IDLE + [Atualizar Localizacao] → request location share
- [ ] On new location: H3-snap → update geometry
- [ ] After location update: show radius menu, allow re-selection
- [ ] Tests: H3 snapping correctness, geometry update, radius change

---

## Phase 4 — Discovery Board (US-04 — Olhar em Volta)

**Branch:** `feat/discovery`

- [ ] Handler: IDLE + [Olhar em Volta] → run geospatial query
- [ ] Query: ST_DWithin + listings JOIN, top 10 ordered by distance, active listings only
- [ ] Format: numbered list, name + distance in km + listing count
- [ ] Save discovery_list in conversation_state.context
- [ ] State → BROWSING (mode = discovery)
- [ ] Handle empty results: suggest increasing radius (button: [Aumentar Raio])
- [ ] Tests: geo query, result formatting, empty result handling, stale listing exclusion

---

## Phase 5 — Bilateral Matching (US-04 — Match Perfeito)

**Branch:** `feat/bilateral-match`

- [ ] Handler: IDLE + [Match Perfeito] → check if wanted_listings exist for user
- [ ] If no want list: prompt to add wants first (same parser as listings)
- [ ] Bilateral query: users nearby who HAVE my wants AND WANT items I HAVE
- [ ] Format: same as discovery board, label "Match Perfeito" next to names
- [ ] State → BROWSING (mode = bilateral)
- [ ] Tests: bilateral query correctness, want list empty case

---

## Phase 6 — Connection Flow (US-05)

**Branch:** `feat/connection`

- [ ] Handler: BROWSING → parse numeric selection ("1", "1 e 3")
- [ ] Insert matches row: status = PENDING
- [ ] Notify User A: "Aguardando confirmacao de {nome B}..."
- [ ] Notify User B: button message: [Sim] [Nao]
- [ ] Handler: User B taps [Sim] → status = CONFIRMED_B → Z-API creates group
- [ ] Bot welcome message in group (no emojis, concise)
- [ ] Update status = CONNECTED
- [ ] Prompt both users: [Atualizar Figurinhas]
- [ ] Handler: User B taps [Nao] → status = DECLINED → notify User A
- [ ] Timeout: 24h with no response → status = EXPIRED → notify User A
- [ ] Both users return to IDLE after resolution
- [ ] Tests: selection parsing, match status transitions, group creation mock, timeout

---

## Phase 7 — Inventory Management (US-02 + US-06)

**Branch:** `feat/inventory`

- [ ] Handler: IDLE + [Atualizar Figurinhas] → show current listings count → ask for update
- [ ] Support: full replacement (send new list) + differential (remover/adicionar)
- [ ] Reset expires_at on any update
- [ ] Pre-expiry job (at 20h mark): send button message: [Sim, ainda tenho] [Atualizar Figurinhas] [Nao tenho mais]
- [ ] State → CONFIRMING_INVENTORY
- [ ] [Sim, ainda tenho] → reset expires_at → IDLE
- [ ] [Atualizar Figurinhas] → re-enter listing update flow
- [ ] [Nao tenho mais] → delete all listings → IDLE → confirm deletion
- [ ] No response in 4h → listings expire silently (cron/pg_cron)
- [ ] Tests: all three button paths, expiry job logic, silent expiry

---

## Phase 8 — Operational Hardening

**Branch:** `feat/ops`

- [ ] pg_cron: daily sweep to hard-delete expired listings (after grace period)
- [ ] Weekly nudge: "Sua localizacao ainda esta correta? Use o menu para atualizar."
- [ ] Rate limiting: max 10 messages/minute per user (prevents loops)
- [ ] Health check endpoint: `GET /api/health` → confirms Supabase + Z-API connectivity
- [ ] All handlers emit structured logs: `{ userId, event, durationMs, outcome }`
- [ ] Error boundary: unhandled state/message type → friendly fallback → IDLE
- [ ] Tests: rate limiter, health check, error boundary fallback

---

## Backlog — Future

- [ ] Bilateral matching refinement: show overlap count ("3 figurinhas em comum")
- [ ] H3 resolution upgrade: evaluate resolution 9 (~174m) for denser urban areas
- [ ] Photo OCR: user sends sticker page photo → extract numbers via vision API
- [ ] Post-trade review: after group created, ask each user to rate the experience (1–5)
- [ ] Generic domain adapter: separate sticker-specific logic into a domain plugin interface
- [ ] WhatsApp username lookup: support @username in addition to phone in all lookups
- [ ] Admin view: Supabase Studio dashboard for monitoring active users and matches
