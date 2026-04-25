# Learnings & Experiments — sticker_exchange

This document captures real observations from building and running the system. It is a living log — add entries as experiments complete, surprises emerge, or assumptions are invalidated.

---

## Format

```
### [date] — [short title]
**Hypothesis / Question:** What were we testing or unsure about?
**Observation:** What actually happened?
**Impact:** Does this change a decision? If so, link the ADR.
**Action:** What do we do next?
```

---

## 2026-04-21 — Project Kickoff

**Hypothesis / Question:** Can a location-based WhatsApp matchmaking engine be built and validated at near-zero cost?

**Observation:** Architecture analysis confirms this is feasible. Z-API (~R$69/month) is the only non-free component and is justified by eliminating WhatsApp session management complexity. All other services (Vercel, Supabase) are within free tiers for MVP volume.

**Impact:** None — proceeding with finalized ADRs.

**Action:** Begin Phase 0 (infrastructure scaffolding).

---

## 2026-04-25 — ESLint v9 flat config: three silent failures discovered during CI setup

**Hypothesis / Question:** Were the linting and test scripts set up correctly after Phase 0 scaffolding?

**Observation:**
- `npm run lint` was silently broken from day one: the `--ext .ts` flag was removed in ESLint v9 flat config mode and causes a fatal error before any file is linted. The error was only surfaced when CI was configured and the commands were run end-to-end.
- `parserOptions.project` in `eslint.config.js` caused a parse error for `tests/` files because they are excluded from `tsconfig.json`'s `include`. It is only needed when type-aware rules (`recommended-type-checked`) are active — the current rule set does not require it.
- Base ESLint rules `no-undef` and `no-redeclare` fire false positives on TypeScript: `process` is flagged as undefined (TypeScript handles globals), and the `const Foo = {} as const / type Foo = ...` declaration-merging pattern is flagged as a redeclaration. Both rules should be disabled for TypeScript files.

**Impact:** No architectural decisions changed. Fixes documented in ADR-013.

**Action:** All three issues fixed in `chore/ci`. Pattern to remember: after any ESLint major version upgrade, verify `--ext` is absent, confirm `parserOptions.project` is only present when type-aware rules are in use, and disable `no-undef` / `no-redeclare` for TypeScript file globs.

---

## 2026-04-25 — Vercel `ERR_MODULE_NOT_FOUND` for relative TypeScript imports

**Hypothesis / Question:** `@vercel/node` compiles TypeScript `api/` functions — will relative imports like `'../src/utils/logger'` resolve correctly at runtime?

**Observation:** No. `@vercel/node` transpiles TypeScript to JavaScript but does **not bundle** relative imports. At runtime, Node.js ESM (triggered by `"type": "module"` in `package.json`) requires explicit `.js` extensions on every relative import — `'../src/utils/logger'` fails; `'../src/utils/logger.js'` works. TypeScript resolves `.js` to the corresponding `.ts` at compile time, so writing `.js` in source is correct.

Additionally, `tsconfig.json` had `rootDir: "src"` and `include: ["src/**/*"]`, which silently excluded `api/` from typechecking. Fixed by setting `rootDir: "."` and adding `"api/**/*"` to `include`.

**Impact:** Smoke test returned `ERR_MODULE_NOT_FOUND` on every Vercel invocation.

**Action:** All relative imports in `api/` now use `.js` extensions. `tsconfig.json` updated to cover `api/`. Rule: in any TypeScript + ESM project, always use `.js` extensions for relative imports.

---

## 2026-04-25 — TypeScript `exactOptionalPropertyTypes` breaks `?? undefined` object spreads

**Hypothesis / Question:** Can you assign `{ phone: x ?? undefined }` to a type with `phone?: string` when `exactOptionalPropertyTypes` is enabled?

**Observation:** No. With `exactOptionalPropertyTypes: true`, an optional property typed as `string?` means the property must be *absent*, not `undefined`. Writing `{ phone: value ?? undefined }` produces `{ phone: string | undefined }`, which TypeScript rejects as incompatible. The fix is conditional assignment:
```typescript
const id: UserIdentifier = {};
if (phone) id.phone = phone;
```

**Impact:** Affected the `UserIdentifier` construction in the webhook router. No architectural change — just a coding pattern to follow throughout.

**Action:** Always use conditional assignment when populating optional-property objects under `exactOptionalPropertyTypes`. See ADR-014 for context.

---

## 2026-04-25 — Vercel env vars lost between deployments; preview requires branch-scoped vars

**Hypothesis / Question:** Will env vars set during Phase 0 (via Vercel dashboard) persist for all future deployments, including preview branches?

**Observation:** No. Env vars were wiped — "No Environment Variables found" — even though the Phase 0 health check had confirmed them. Root cause unknown (likely a project re-link or dashboard reset). Additionally, Vercel CLI v6+ requires `--value <v>` AND an explicit branch for preview-scoped vars: `vercel env add KEY preview feat/branch --value VALUE --yes`. Omitting the branch produces an interactive prompt that blocks scripted adds.

**Impact:** All preview (feature branch) and production deployments failed at startup with `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`.

**Action:**
1. All vars re-added: 10 to `Production`, 10 to `Preview (feat/onboarding)`.
2. Future branches: run `vercel env add KEY preview <branch> --value VALUE --yes` for each new feature branch OR promote vars to all-preview after confirming the CLI syntax.
3. Add env var check to the PR checklist: confirm `vercel env ls` shows all required vars for the target environment before merging.

---

## 2026-04-25 — Webhook 401: Z-API uses `z-api-token` header, not `client-token`

**Hypothesis / Question:** Why does every Z-API webhook request return 401 even after verifying env vars are set?

**Observation:**
Inspecting the actual Z-API webhook via webhook.site revealed two bugs written against incorrect assumptions about Z-API's protocol:

1. **Wrong auth header**: The webhook handler checked `req.headers['client-token']`, but Z-API never sends that header on incoming webhooks. Z-API sends `z-api-token: <ZAPI_TOKEN_VALUE>`. The `Client-Token` mentioned in Z-API's "Segurança" page is a token WE send in headers when calling Z-API's API — not what Z-API sends us. The webhook auth now checks `z-api-token` against `ZAPI_TOKEN`.

2. **Flat payload, not nested**: The Zod schema and all handlers assumed Z-API wraps `messageId`, `fromMe`, `text`, `location`, etc. inside a nested `message` object. The actual payload is flat — all fields are at the root level alongside `type`, `phone`, and `instanceId`. Every incoming message was silently dropped at the parse step (`webhook_parse_failed` warn log) even if auth had passed.

The root cause of both bugs: Z-API was integrated without testing against the real webhook format. The `ZApiWebhookPayload` interface in `src/types/index.ts` was written speculatively using a nested structure that does not match Z-API's actual REST contract.

**Impact:** Entire Phase 1 flow was unreachable in production. No users could be created, no onboarding messages sent.

**Action:**
- `api/webhook.ts`: check `z-api-token` header against `ZAPI_TOKEN`.
- `src/webhook/schema.ts`: flattened to match real Z-API payload.
- All handlers and tests updated accordingly.
- Rule going forward: for any new Z-API webhook event type, capture a real sample via webhook.site before writing the schema. Never write a schema against documentation alone.

---

## Pending Experiments

- [ ] Z-API webhook latency: measure time from user message to Vercel handler invocation
- [ ] Vercel cold start: measure end-to-end response time on first invocation after idle period
- [ ] Supabase connection pooler: confirm pooler handles burst of concurrent Vercel invocations without connection errors
- [ ] H3 snapping accuracy: validate that `ST_DWithin` at 1km radius returns correct results when both users have snapped coordinates
- [ ] Onboarding completion rate: what % of users who send a first message complete all onboarding steps?
- [ ] Location share friction: what % of users share WA location vs. dropping off at that step?
- [ ] Inventory input friction: what % of users successfully send a parseable listing on first try?
- [ ] Discovery board engagement: what % of users who see the board follow through to a connection request?
- [ ] Pre-expiry button distribution: which button do users tap most — [Sim] vs [Atualizar] vs [Nao tenho mais]?
- [ ] 24h expiry: does 24h feel too short for users, or does it produce a healthier board?

---

## Known Unknowns

- Z-API's exact ban threshold for message volume and group creation rate
- Whether Brazilian users will prefer voice messages over text for sticker number input
- Whether the "Olhar em Volta" vs "Match Perfeito" split is understood without explanation
- Optimal H3 resolution: 8 (~460m) chosen for privacy, but resolution 9 (~174m) may be better in dense urban areas
- Whether pg_cron on Supabase free tier is sufficient for 20h pre-expiry job scheduling, or if an external cron (GitHub Actions scheduled workflow) is more reliable
