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

## Phase 9 — Meeting Place Suggestions

**Goal:** When two users connect, the bot suggests a nearby business as a physical meeting point for the trade.

**Depends on:** Phase 6 (connection flow must exist)

**Deliverables:**
- `meeting_places` table (name, address, neighborhood, geometry) with GIST index
- `find_nearest_meeting_place_for_users` RPC: computes midpoint of both users' H3 cells, returns closest active place within 3 km
- Place suggestion sent as a follow-up message in the group after creation (non-fatal: no place → welcome message only)
- Manual data entry via Supabase SQL (no admin UI for now)

**Done when:** Two connected users in the same area receive the group welcome message followed by the nearest place name, address, and distance. Users in areas with no registered places receive only the welcome message.

**Estimated effort:** 1 day

---

## Phase 10 — First Real User Test

**Goal:** 5–10 real users complete the full flow in a controlled test.

**Depends on:** Phase 9

**Activities:**
- Recruit testers from a real sticker-trading context
- Instrument key funnel metrics: onboarding completion rate, discovery engagement, connection rate
- Monitor Z-API for ban signals, Vercel for timeout errors
- Log all dropped sessions and classify the drop reason

**Outcome:** A set of qualitative findings that inform whether to continue, pivot the UX, or change the matching strategy.

---

## Phase 11 — Bug Fixes & UX Improvements (Post First Real Test)

**Goal:** Corrigir os 6 problemas identificados durante o primeiro teste real com usuários e
elevar a qualidade da UX antes de escalar para mais testadores.

**Depends on:** Phase 10 (First Real User Test — completed)

### US-11.1 — Precisão geográfica: upgrade H3 de resolução 8 para 9 ou 10

Dois usuários a ~300 m de distância real aparecem como "0 m" um do outro porque ambos ficam
dentro da mesma célula H3 (resolução 8 tem ~461 m de diâmetro). Com resolução 9 (~174 m) ou
10 (~65 m), esse colapso desaparece.

Como há poucos usuários em teste, perder as localizações existentes é aceitável — eles precisarão
re-compartilhar a localização na próxima mensagem. A escolha de resolução final (9 vs 10) depende
do trade-off entre precisão (~174 m vs ~65 m) e privacidade. Resolução 9 é o mínimo; resolução 10
é segura para áreas urbanas densas onde a maioria dos usuários está.

Mudanças envolvidas: nova migration SQL que altera a função de H3-snap + invalida localizações
existentes; update da constante de resolução no código TypeScript; atualização dos ADRs e testes.

### US-11.2 — Compactação de figurinhas no perfil de discovery

Ao ver o perfil de outra pessoa em "Olhar em Volta", as figurinhas aparecem como
"BRA1, BRA2, BRA3, BRA4, BRA5" em vez de "BRA1-5". Isso torna listas longas ilegíveis.

A lógica de compactação por intervalos já existe em `formatListingPreview()` para o fluxo de
confirmação; basta extraí-la como função compartilhada e aplicá-la também em `formatProfiles()`.

### US-11.3 — Bot em loop de onboarding dentro do grupo criado

Quando o bot cria o grupo e é adicionado a ele, qualquer mensagem dos participantes dispara
o webhook. O JID do grupo não corresponde a nenhum usuário, então o bot inicia o fluxo de
onboarding dentro do grupo — "Para começar, informe seu nome" aparece no meio da conversa.

A solução é detectar o formato do `phone` no payload Z-API para mensagens de grupo (JIDs de
grupo têm formato diferente dos individuais) e descartar essas mensagens antes do roteamento,
devolvendo 200 silencioso ao Z-API.

### US-11.4 — Diagnóstico e seed de pontos de encontro

Usuários reportam que o local de encontro não apareceu no grupo após a conexão. O código em
`connection-response.ts` já envia a sugestão, mas de forma não-fatal — se a tabela
`meeting_places` estiver vazia ou a query falhar, o bot apenas omite a mensagem sem logar.

Esta story tem duas partes: (a) melhorar a observabilidade distinguindo "lugar não encontrado"
de "query com erro", e (b) garantir que a tabela `meeting_places` tenha dados cadastrados para
a área de teste.

### US-11.5 — Confirmação de nome no onboarding

Hoje o nome digitado pelo usuário é salvo diretamente sem confirmação. Digitou "João da Sliva"
por engano? Não há como corrigir sem reiniciar o cadastro. O padrão de echo-back com
[Confirmar] [Alterar] já existe para figurinhas; basta replicá-lo para o passo do nome.

### US-11.6 — Acumulação de figurinhas enviadas em mensagens separadas

Ao enviar "BRA1", depois "BRA4", depois "BRA7" como três mensagens distintas, o bot processa
cada uma individualmente e apenas a última ("BRA7") é confirmada — as duas primeiras são
substituídas. O usuário percebe isso como o bot "ignorando" mensagens.

A solução é um modo de acumulação: cada nova mensagem de códigos é somada ao contexto já
acumulado, e o bot exibe a lista corrente com opções explícitas [Continuar adicionando] [Confirmar]
[Corrigir]. Isso é preferível a um debounce por timer porque (a) serverless não mantém estado
entre invocações, (b) dá ao usuário controle direto sobre quando a lista está pronta.

### US-11.7 — Copias de texto do onboarding mais amigáveis

A mensagem de boas-vindas ("Bem-vindo ao Trocar Figurinhas\nAntes de começarmos, qual é o seu
nome?"), o echo-back de confirmação de nome ("Nome: NOME\n\nConfirma?") e o re-prompt após
[Alterar] ("Envie seu nome (entre 2 e 50 caracteres)") soam formais e técnicos para um fluxo
conversacional.

Mudanças pontuais de cópia: welcome → "Oi! Bem vindo ao Trocar Figurinhas, qual é o seu nome?";
echo-back → "Seu nome é NOME, está certo?"; re-prompt → "Claro, qual é o seu nome?". Os testes
de snapshot de texto precisam ser atualizados para refletir as novas strings.

### US-11.8 — Simplificar UX de acumulação e corrigir mapeamento de botões

Durante os testes, ao enviar figurinhas em mensagens separadas e tentar confirmar, a lista era
apagada em vez de salva. A causa raiz: o botão "Adicionar mais" foi adicionado na posição 0 do
array, deslocando "Confirmar" para posição 2, mas `textInput === '1'` ainda mapeava para confirm
e `textInput === '2'` para corrigir. Com text fallback ativo, o usuário vê "2 - Confirmar" na
tela, digita "2", e o código interpreta como Corrigir — limpando a lista.

A solução é remover o botão "Adicionar mais" (redundante: o usuário já pode digitar mais códigos
sem apertar nenhum botão) e atualizar o echo-back para deixar claro que continuar digitando é o
caminho natural. Com 2 botões `[Confirmar, Corrigir]`, o mapeamento text fallback volta a ser
consistente: '1' = confirmar, '2' = corrigir.

### US-11.9 — Habilitar botões nativos WhatsApp via Z-API (conta paga)

O `sendButtons` e `sendList` em `src/services/zapi.ts` ainda usam um text fallback ("1 - Label\n
2 - Label\n\nResponda com o numero.") adicionado quando a conta estava no plano trial. Com a
conta paga, a Z-API suporta botões nativos do WhatsApp — o usuário toca um elemento interativo
em vez de digitar números, e `buttonsResponseMessage.selectedButtonId` é preenchido no webhook.

Todos os handlers já roteiam por `buttonId` corretamente. A única mudança é substituir a
implementação de `sendButtons` (endpoint `send-button-actions`) e `sendList` (endpoint
`send-list-message`) pelo chamado real à API Z-API e remover os comentários TEMP.

**Done when:** Todos os 9 itens acima têm testes passando e foram validados manualmente com
pelo menos dois números de WhatsApp distintos.

**Estimated effort:** 4–5 dias (US-11.7/11.8/11.9 adicionam ~2 dias ao esforço original)

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
