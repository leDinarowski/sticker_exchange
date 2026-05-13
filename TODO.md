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
- [DONE — 2026-04-25] Smoke test: send any message to bot number, confirm webhook fires and Vercel receives it
- [DONE — 2026-04-24] Set up GitHub repo with branch protection on `main` (require PR + passing CI)
- [DONE — 2026-04-25] Set up GitHub Actions CI: `npm run typecheck && npm run lint && npm test`

---

## Phase 1 — Onboarding (US-01)

**Branch:** `feat/onboarding`

- [DONE — 2026-04-25] Implement conversation state machine (state transitions + JSONB persistence)
- [DONE — 2026-04-25] Router: any message from unknown number → trigger onboarding (state = NEW)
- [DONE — 2026-04-25] Handler: NEW → send welcome message, button: [Comecar]
- [DONE — 2026-04-25] Handler: ONBOARDING_NAME → validate name (2–50 chars), save, send terms (buttons: [Aceito] [Recuso])
- [DONE — 2026-04-25] Handler: ONBOARDING_TERMS → on Aceito: record `consented_at`, ask for location share
- [DONE — 2026-04-25] Handler: ONBOARDING_TERMS → on Recuso: save `refused_at`, stop processing future messages gracefully
- [DONE — 2026-04-25] Handler: ONBOARDING_LOCATION → receive WA location message, H3-snap, save geometry, ask for radius
- [DONE — 2026-04-25] Radius prompt uses button message: [1 km] [3 km] [5 km] (7 km dropped — 3 button limit; re-add in Phase 3)
- [DONE — 2026-04-25] Handler: ONBOARDING_RADIUS → save `radius_km`, ask for listings
- [DONE — 2026-04-25] Graceful error handling: invalid input at each step → re-prompt, max 3 retries
- [DONE — 2026-04-25] Tests: unit tests for each state transition, mock Z-API calls
- [DONE — 2026-04-25] Tests: integration test for full onboarding sequence

---

## Phase 2 — Listing Registration (US-02)

**Branch:** `feat/listing-registration`

- [DONE — 2026-04-25] Parser: alphanumeric codes ("BRA5", "ARG3"), ranges within team ("BRA5-10"), comma-separated mixed
- [DONE — 2026-04-25] Differential parser: "remover BRA5, ARG3" / "adicionar BRA5"
- [DONE — 2026-04-25] Validation: domain = 'sticker', code must match team prefix + 1–20, FWC00/FWC1–FWC19, or CC1–CC14 (see `stickers_context.md`)
- [DONE — 2026-04-25] Deduplication: prevent same code twice for same user
- [DONE — 2026-04-25] Echo-back confirmation: bot shows parsed list, buttons: [Confirmar] [Corrigir]
- [DONE — 2026-04-25] On confirm: insert listings, `expires_at` = NOW() + 24h
- [DONE — 2026-04-25] State → IDLE → show main menu
- [DONE — 2026-04-25] Main menu buttons: [Olhar em Volta] [Match Perfeito] [Atualizar Figurinhas] [Atualizar Localizacao]
- [DONE — 2026-04-25] Tests: all parser edge cases, deduplication, expiry assignment

---

## Phase 3 — Location & Radius Update (US-03)

**Branch:** `feat/location`

- [DONE — 2026-04-26] Handler: IDLE + [Atualizar Localizacao] → request location share
- [DONE — 2026-04-26] On new location: H3-snap → update geometry
- [DONE — 2026-04-26] After location update: show radius menu, allow re-selection
- [DONE — 2026-04-26] Tests: H3 snapping correctness, geometry update, radius change

---

## Phase 4 — Discovery Board (US-04 — Olhar em Volta)

**Branch:** `feat/discovery`

- [DONE — 2026-04-26] Handler: IDLE + [Olhar em Volta] → run geospatial query
- [DONE — 2026-04-26] Query: ST_DWithin + listings JOIN, top 10 ordered by distance, active listings only
- [DONE — 2026-04-26] Format: numbered list, name + distance in km + listing count
- [DONE — 2026-04-26] Save discovery_list in conversation_state.context
- [DONE — 2026-04-26] State → BROWSING (mode = discovery)
- [DONE — 2026-04-26] Handle empty results: transition to ONBOARDING_RADIUS with updating_location; show radius menu
- [DONE — 2026-04-26] BROWSING: parse single/multi selection, show profile deep-dive with sticker list per person
- [DONE — 2026-04-26] Profile view: [Entrar em contato] stub + [Voltar] (supports comma/range multi-select)
- [DONE — 2026-04-26] Tests: geo query, result formatting, empty result handling, selection parsing, profile view, Voltar

---

## Phase 5 — Bilateral Matching (US-04 — Match Perfeito)

**Branch:** `feat/bilateral-match`

- [DONE — 2026-04-26] Handler: IDLE + [Match Perfeito] → check if wanted_listings exist for user
- [DONE — 2026-04-26] If no want list: prompt to add wants first (same parser as listings)
- [DONE — 2026-04-26] Bilateral query: users nearby who HAVE my wants AND WANT items I HAVE
- [DONE — 2026-04-26] Format: same as discovery board, label "Match Perfeito" next to names
- [DONE — 2026-04-26] State → BROWSING (mode = bilateral)
- [DONE — 2026-04-26] Tests: bilateral query correctness, want list empty case

---

## Phase 6 — Connection Flow (US-05)

**Branch:** `feat/connection`

- [DONE — 2026-04-26] Handler: BROWSING → parse numeric selection ("1", "1 e 3")
- [DONE — 2026-04-26] Insert matches row: status = PENDING
- [DONE — 2026-04-26] Notify User A: "Pedido enviado para {nome B}. Voce sera avisado quando responderem."
- [DONE — 2026-04-26] Notify User B: button message: [Sim] [Nao] (text fallback for trial account)
- [DONE — 2026-04-26] Handler: User B taps [Sim] → status = CONFIRMED_B → Z-API creates group
- [DONE — 2026-04-26] Bot welcome message in group (no emojis, concise)
- [DONE — 2026-04-26] Update status = CONNECTED
- [DONE — 2026-04-26] Both users returned to IDLE with main menu after resolution
- [DONE — 2026-04-26] Handler: User B taps [Nao] → status = DECLINED → notify User A
- [DONE — 2026-04-26] Timeout: 24h lazy expiry → status = EXPIRED → notify User A on next message
- [DONE — 2026-04-26] Both users return to IDLE after resolution
- [DONE — 2026-04-26] Tests: selection parsing, match status transitions, group creation mock, timeout, text fallback

---

## Phase 7 — Inventory Management (US-02 + US-06)

**Branch:** `feat/inventory`

- [DONE — 2026-05-02] Handler: IDLE + [Atualizar Figurinhas] → show current listings count → ask for update
- [DONE — 2026-05-02] Support: full replacement (send new list) + differential (remover/adicionar)
- [DONE — 2026-05-02] Reset expires_at on any update
- [DONE — 2026-05-02] Pre-expiry job (at 20h mark): send button message: [Sim, ainda tenho] [Atualizar Figurinhas] [Nao tenho mais]
- [DONE — 2026-05-02] State → CONFIRMING_INVENTORY
- [DONE — 2026-05-02] [Sim, ainda tenho] → reset expires_at → IDLE
- [DONE — 2026-05-02] [Atualizar Figurinhas] → re-enter listing update flow
- [DONE — 2026-05-02] [Nao tenho mais] → delete all listings → IDLE → confirm deletion
- [DONE — 2026-05-02] No response in 4h → listings expire silently (passive — expires_at passes)
- [DONE — 2026-05-02] Tests: all three button paths, expiry job logic, cron endpoint auth

---

## Phase 8 — Operational Hardening

**Branch:** `feat/ops`

- [DONE — 2026-05-03] pg_cron: daily sweep to hard-delete expired listings (after grace period)
- [DONE — 2026-05-03] Weekly nudge: "Sua localizacao ainda esta correta? Use o menu para atualizar."
- [DONE — 2026-05-03] Rate limiting: max 10 messages/minute per user (prevents loops)
- [DONE — 2026-05-03] Health check endpoint: `GET /api/health` → confirms Supabase + Z-API connectivity
- [DONE — 2026-05-03] All handlers emit structured logs: `{ userId, event, durationMs, outcome }`
- [DONE — 2026-05-03] Error boundary: unhandled state/message type → friendly fallback → IDLE
- [DONE — 2026-05-03] Tests: rate limiter, health check, error boundary fallback

---

## Phase 9 — Meeting Place Suggestions

**Branch:** `feat/meeting-places`

- [DONE — 2026-05-03] `meeting_places` table with GIST index + `find_nearest_meeting_place_for_users` RPC
- [DONE — 2026-05-03] Meeting place suggestion sent in group after connection (non-fatal: missing place → welcome message only)
- [DONE — 2026-05-03] 3 km radius from midpoint of both users' H3 cell centers; closest place only
- [DONE — 2026-05-03] Message format: name, address/neighborhood, distance in m or km (BR decimal comma)
- [DONE — 2026-05-03] Tests: DB query (5), formatter (9), connection-response additions (3)

---

## Phase 10 — Bug Fixes & UX Improvements

**Branch:** `fix/post-test-improvements`

**US-10.1 — Upgrade H3 res 8 → 9 ou 10 para precisão geográfica**
- [DONE — 2026-05-13] Decidir resolução final: res 9 (~174 m) vs res 10 (~65 m) — ver ADR-026 (escolhido res 10)
- [DONE — 2026-05-13] Criar migration SQL: setar `location = NULL` para todos os usuários ativos (`20260513000000_h3_res10_reset_locations.sql`)
- [DONE — 2026-05-13] Atualizar constante de resolução em `src/services/location.ts` (H3_RESOLUTION 8 → 10)
- [DONE — 2026-05-13] Garantir que `ST_DWithin` e `ST_Distance` continuem corretos após o re-snap (funções SQL são agnósticas à resolução)
- [DONE — 2026-05-13] Atualizar `formatDistance()` em `src/utils/format-discovery.ts` e `src/utils/format-meeting-place.ts` se necessário (sem alterações necessárias — funções são agnósticas)
- [DONE — 2026-05-13] Testes: H3-snap para dois pontos a 300 m → dist_m > 0; regressão em todos os testes geoespaciais existentes

**US-10.2 — Compactar lista de figurinhas no perfil de discovery**
- [ ] Extrair função `compactCodes(codes: string[]): string` de `formatListingPreview()` em `src/utils/listing-parser.ts`
- [ ] Aplicar compactação sempre (remover o guard `codes.length > 10`)
- [ ] Usar `compactCodes` em `formatProfiles()` em `src/utils/format-discovery.ts:25`
- [ ] Testes: `compactCodes(['BRA1','BRA2','BRA3','BRA4','BRA5'])` → `'BRA1-5'`; prefixos múltiplos; lista de 1 item

**US-10.3 — Ignorar mensagens de grupo no webhook**
- [DONE — 2026-05-13] Inspecionar payload Z-API para mensagem de grupo (logar ou consultar docs) para confirmar formato do `phone`
- [DONE — 2026-05-13] Em `api/webhook.ts`, antes de `findUser`: detectar JID de grupo e retornar 200 silencioso
- [DONE — 2026-05-13] Atualizar `src/webhook/schema.ts` se necessário para aceitar campo identificador de grupo
- [DONE — 2026-05-13] Testes: payload com phone de grupo → `findUser` não é chamado, retorna 200

**US-10.4 — Diagnóstico e seed de pontos de encontro**
- [ ] Verificar se `meeting_places` tem dados para a área de teste; criar seed SQL se vazia
- [ ] Em `src/handlers/connection-response.ts:138`: adicionar log `meeting_place_not_found` quando `placeResult.value` é null
- [ ] Distinguir "lugar não encontrado" (log info) de "query com erro" (log warn) nos logs
- [ ] Testes: mock `findNearestMeetingPlace` retornando null → log `meeting_place_not_found` emitido

**US-10.5 — Echo-back de confirmação para nome no onboarding**
- [ ] Em `src/handlers/onboarding-name.ts`: ao receber texto válido, armazenar `pending_name` no contexto em vez de salvar diretamente
- [ ] Enviar echo-back: "Nome: XPTO\n\nConfirma?" com botões [Confirmar] [Alterar]
- [ ] Ao [Confirmar]: salvar nome, avançar; ao [Alterar]: limpar `pending_name`, re-perguntar
- [ ] Atualizar schema de contexto JSONB em `.claude/skills/state-machine/SKILL.md`
- [ ] Testes: nome digitado → echo-back enviado + pending_name salvo; [Confirmar] → nome salvo; [Alterar] → re-prompt

**US-10.6 — Modo de acumulação para figurinhas em mensagens separadas**
- [ ] Em `src/handlers/onboarding-listings.ts`: ao receber códigos sem confirmação pendente, acrescentar a `context.accumulated_codes` (deduplicar)
- [ ] Exibir lista corrente acumulada com botões [Continuar adicionando] [Confirmar] [Corrigir]
- [ ] [Confirmar]: processar `accumulated_codes` como lista final; [Corrigir]: limpar acumulado, re-perguntar
- [ ] Manter compatibilidade: enviar tudo de uma vez ainda funciona (acumula lista com 1 mensagem e pede confirmação)
- [ ] Testes: 2 mensagens separadas → accumulated_codes contém ambas; duplicata → deduplica; [Confirmar] → salva combinado
