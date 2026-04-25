# Architecture Decision Records — sticker_exchange

ADRs document the reasoning behind key technical choices. Each decision is immutable once accepted — superseded decisions link to their replacement.

---

## ADR-001: WhatsApp Integration via Z-API

**Status:** Accepted
**Date:** 2026-04-21

### Context
We need to send and receive WhatsApp messages without access to the official WhatsApp Business API. Options evaluated:

| Option | Cost | Ban Risk | Webhook | Ops burden |
|---|---|---|---|---|
| Baileys (direct) | Free | Medium | Node events only | High — persistent process, QR management |
| Evolution API (self-hosted) | Free | Medium | Native HTTP | High — you own the server and reconnects |
| Z-API (SaaS) | ~R$69/mo | Low | Native HTTP | None — fully managed |

### Decision
Use **Z-API** (managed SaaS).

### Rationale
- Z-API handles WhatsApp session management, QR reconnection, and uptime. We never touch the WA connection layer.
- Native HTTP webhook support is essential for Vercel serverless — no persistent process needed on our side.
- The R$69/month cost is justified by eliminating an entire category of operational failure (session drops, QR re-scans, debugging unofficial protocol changes) that would distract from product development at the MVP stage.
- If cost becomes a concern at scale, migrating to a self-hosted Evolution API is feasible — the webhook interface pattern is similar.

### Risks & Mitigations
- **Account ban**: Use a dedicated phone number (not personal). Implement rate limiting. Never send bulk/broadcast messages.
- **WA ToS violation**: Acceptable for MVP validation. Must switch to official API before any commercial launch.
- **Vendor lock-in**: Z-API's interface is standard REST + webhooks. Migrating to another provider is a config change, not a rewrite.

---

## ADR-002: Database — Supabase (PostgreSQL + PostGIS)

**Status:** Accepted
**Date:** 2026-04-21

### Context
We need a database with: (a) geospatial radius queries, (b) zero cost at MVP scale, (c) good serverless integration, (d) connection pooling for Vercel.

### Decision
Use **Supabase** with PostGIS extension + Supavisor connection pooler.

### Rationale
- PostGIS is first-class in Supabase — `ST_DWithin` with a GIST index handles radius queries efficiently.
- Supabase's built-in connection pooler (Supavisor/PgBouncer) is essential for Vercel: serverless functions open a new DB connection per invocation, which would exhaust PostgreSQL's connection limit without pooling.
- All application code must connect via `SUPABASE_DB_POOLER_URL`, never the direct DB URL.
- Free tier (500MB, 2GB bandwidth) is sufficient for MVP.

### Key Schema Decisions
- `users.location` stored as `GEOMETRY(Point, 4326)` after H3 snapping (see ADR-010).
- GIST index on `users.location` is mandatory — add in first migration.
- Exact coordinates are never returned to any client — only distances.

---

## ADR-003: Domain-Generic Data Model — listings + wanted_listings

**Status:** Accepted
**Date:** 2026-04-21

### Context
The initial use case is sticker trading, but the engine must be reusable for other domains.

### Decision
Use a generic `listings` table and `wanted_listings` table from day one instead of a `stickers` table.

```sql
CREATE TABLE listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,           -- 'sticker', 'service', 'product', ...
  payload     JSONB NOT NULL,          -- { "number": 45 } for stickers
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wanted_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Rationale
- Adding a new domain requires zero schema migration: add rows with a new `domain` value.
- Sticker-specific logic (number range validation 1–670, parser) lives only in the sticker domain module.
- Both tables are created from day one — retrofitting a generic model onto a sticker-specific schema later is expensive.

---

## ADR-004: Matching Strategy — Both Modes from Day One

**Status:** Accepted
**Date:** 2026-04-21

### Context
Two matching strategies evaluated:

- **Passive discovery ("Olhar em Volta")**: user sees nearby people with available listings, self-selects. Simpler, lower onboarding friction.
- **Bilateral matching ("Match Perfeito")**: user declares wants, system finds bilateral swap opportunities. Higher match quality.

### Decision
Implement **both modes from day one**, surfaced as two buttons in the main menu. The `wanted_listings` table exists from the first migration.

### Rationale
- Building both is marginal extra effort when done from the start (different query paths, same infrastructure).
- Users have different mental models — some want to browse, some want a precise match. Forcing one mode limits adoption.
- Showing "Match Perfeito" as a real option from launch avoids the UX debt of adding it later.

---

## ADR-005: Hosting — Vercel Serverless

**Status:** Accepted
**Date:** 2026-04-21

### Context
Vercel serverless is the primary candidate. The WhatsApp WebSocket requirement was a concern.

### Decision
Use **Vercel serverless** for all business logic. Z-API manages the WhatsApp WebSocket externally.

### Rationale
- The persistent WebSocket lives entirely inside Z-API. Our code only receives HTTP POST webhooks and makes HTTP REST calls — fully stateless and serverless-compatible.
- Vercel Hobby plan (free) is sufficient for MVP.
- **Timeout consideration**: Vercel Hobby has a 10-second function timeout. This is acceptable if all operations (DB read + Z-API call + DB write) complete within that window. Upgrade to Vercel Pro ($20/month, 60-second timeout) if timeout errors appear in production — it is a one-click upgrade, not a migration.

---

## ADR-006: Post-Match Connection — WhatsApp Group with Bilateral Consent

**Status:** Accepted
**Date:** 2026-04-21

### Context
After match selection, users need a way to communicate. Two options: phone number exchange or WhatsApp group creation.

### Decision
Create a **WhatsApp group** only after **both User A and User B explicitly consent**.

### Rationale
- Under LGPD, phone numbers are sensitive PII. Group creation avoids direct number disclosure before mutual consent.
- Double consent (A selects → B confirms) is both safer and better UX: no one gets surprise group additions.
- Match record has status `PENDING` → `CONFIRMED_B` → `CONNECTED` to track consent state.
- If User B declines or does not respond within 24 hours, the match expires and User A is notified. No group is ever created without explicit acceptance from both parties.

---

## ADR-007: Conversation Navigation — Button Menus, No Keyword Detection

**Status:** Accepted
**Date:** 2026-04-21

### Context
Options for handling user intent: (a) keyword detection ("buscar", "procurar", etc.), (b) structured button menus.

### Decision
Use **Z-API button/list messages** for all points of navigation. No keyword parsing for intent routing.

### Rationale
- Keyword detection is fragile: regional variants, typos, languages, ambiguity. Every synonym is a maintenance burden.
- Button messages are predictable and teach users the vocabulary.
- Z-API supports WhatsApp native button messages and list messages — rendered as interactive UI in the chat.
- All button labels must be 20 characters or fewer. No emojis anywhere in message copy.
- Free-text input is only accepted where the user must provide open-ended data (name, listing numbers, location share).

---

## ADR-008: Conversation State — JSONB in PostgreSQL

**Status:** Accepted
**Date:** 2026-04-21

### Context
Vercel functions are stateless. User conversation state must be externalized.

### Decision
Store conversation state as JSONB in `users.conversation_state`. Connect via Supabase connection pooler to avoid connection exhaustion.

### Rationale
- No additional service = no additional cost or failure point at MVP scale.
- State transitions are infrequent (one per user message).
- JSONB allows flexible context payloads (discovery list, pending match IDs, etc.).
- Connection pooler (see ADR-002) is essential — without it, Vercel invocations exhaust PostgreSQL connections.

### State Schema Example
```json
{
  "step": "BROWSING",
  "context": {
    "mode": "discovery",
    "discovery_list": [
      { "rank": 1, "user_id": "uuid-a", "name": "Joao", "items": [12, 45, 78] },
      { "rank": 2, "user_id": "uuid-b", "name": "Maria", "items": [33, 91] }
    ]
  },
  "updated_at": "2026-04-21T14:00:00Z"
}
```

---

## ADR-009: Listing Expiry — 24h with Pre-Expiry Confirmation

**Status:** Accepted
**Date:** 2026-04-21

### Context
Stale listings degrade discovery board quality. 30-day expiry is too long — users trade within hours or days, not weeks.

### Decision
- Listings expire after **24 hours**.
- At **20 hours**, bot sends a confirmation message with three buttons: [Sim, ainda tenho] [Atualizar Figurinhas] [Nao tenho mais].
- [Sim] resets `expires_at` to NOW() + 24h, zero friction.
- [Atualizar Figurinhas] re-enters the listing update flow (ranges + differential + echo-back confirmation).
- [Nao tenho mais] deletes all listings for the user immediately.
- No response in 4 hours after the nudge → listings expire passively. No further messages sent.
- After a successful group creation (trade initiated), both users are immediately prompted to review their inventory.

### Listing Input Rules (enforced in parser)
- Accepts ranges: "12-25" expands to 12,13,...,25.
- Accepts comma-separated: "12, 45, 78".
- Accepts differential: "remover 45, 78" or "adicionar 203".
- After any full list submission, bot echoes parsed numbers for confirmation before saving.
- Valid range for sticker domain: 1–670 (World Cup 2026 album).

---

## ADR-010: Location Privacy — H3 Snapping + Geometry Storage

**Status:** Accepted
**Date:** 2026-04-21

### Context
Storing exact GPS coordinates is a LGPD concern. We need to balance query accuracy with privacy.

### Decision
Apply **H3 hex snapping at resolution 8** before storing any location. Store the snapped coordinates as `GEOMETRY(Point, 4326)` in PostGIS. Never store or return exact GPS coordinates.

### How They Work Together
H3 and PostGIS are complementary, not competing:
1. WhatsApp sends exact GPS → `h3-js` snaps to nearest hex center at resolution 8 (~460m precision) → coordinates are now anonymized.
2. Anonymized coordinates are stored as PostGIS `GEOMETRY` for efficient spatial querying.
3. `ST_DWithin` and `ST_Distance` operate on the snapped geometry. Sub-460m precision is lost, which is irrelevant for 1–7km radius searches.
4. Only distance values are ever returned to clients. Coordinates are never exposed.

### Privacy Benefit
Even a full database breach reveals only "user is somewhere in this ~460m neighborhood hexagon" — not a home address.

---

## ADR-011: User Identifier — Phone + wa_username

**Status:** Accepted
**Date:** 2026-04-21

### Context
WhatsApp is rolling out @username as an alternative to phone numbers. Our schema must accommodate this without a future breaking migration.

### Decision
- Primary key: UUID (never phone or username).
- `phone`: TEXT UNIQUE, required today.
- `wa_username`: TEXT UNIQUE NULLABLE, added from day one.
- User lookup: query by phone OR wa_username.

### Rationale
- UUID as PK ensures no structural change is needed when wa_username becomes more prominent.
- Adding the nullable column now costs nothing; retrofitting it later onto a live schema is risky.
- Both fields are PII under LGPD — same treatment as phone.

---

## ADR-012: Location Updates — User-Initiated + Weekly Nudge

**Status:** Accepted
**Date:** 2026-04-21

### Context
User locations become stale when users move. Auto-detecting movement is not feasible via WhatsApp.

### Decision
- Location update is available as a menu button: [Atualizar Localizacao].
- A weekly soft nudge is sent alongside the inventory confirmation: "Sua localizacao ainda esta correta? Use o menu para atualizar se necessario."
- No forced re-registration of location.

### Rationale
- User-initiated updates cover intentional moves (neighborhood change, attending an event).
- Weekly nudge catches forgetful users without being intrusive.
- Both mechanisms together provide sufficient freshness for the proximity use case.

---

## ADR-013: CI — GitHub Actions + ESLint v9 Flat Config Gotchas

**Status:** Accepted
**Date:** 2026-04-25

### Context
Setting up GitHub Actions CI (`typecheck → lint → test`) surfaced several pre-existing issues in the ESLint configuration that had been silently masked by a broken lint script.

### Decision
Single-job workflow (typecheck → lint → test sequentially) using `actions/setup-node@v4` with `cache: 'npm'`. Three ESLint configuration fixes applied alongside.

### Rationale & Gotchas

**`--ext` flag removed from lint script**
ESLint v9 flat config does not support `--ext`. Passing it produces a fatal error and the linter never runs. Extension filtering is handled by the `files` glob in `eslint.config.js` instead.

**`parserOptions.project` removed**
`parserOptions.project` causes a parse error for any file not listed in `tsconfig.json`'s `include` (e.g. `tests/`). It is only needed when type-aware lint rules are active. The current rule set uses `recommended` (not `recommended-type-checked`), so no rule requires it. Remove it unless type-aware rules are explicitly added.

**`no-undef: 'off'` for TypeScript files**
The base `no-undef` rule fires false positives on Node.js built-ins (`process`, `Buffer`, etc.) in TypeScript source. TypeScript's own compiler catches undefined globals — `no-undef` is redundant and noisy in TS files.

**`no-redeclare: 'off'` for TypeScript files**
The base `no-redeclare` rule fires on the standard TypeScript `const Foo = {} as const / type Foo = ...` pattern (declaration merging across value and type namespaces). TypeScript itself enforces redeclaration rules correctly.

**`"type": "module"` in package.json**
`eslint.config.js` uses `import.meta.dirname`, which is valid only in ES modules. Without `"type": "module"`, Node.js emits a performance warning and re-parses the file as ESM. Adding `"type": "module"` makes the project's module format explicit.

### CI Workflow Structure
- Trigger: `pull_request` (any branch) + `push` to `main`
- One job, sequential steps — avoids per-job checkout/install overhead which outweighs any parallelism benefit at this project size
- `npm ci` (not `npm install`) — deterministic, errors if lockfile is out of sync
- Step order: typecheck → lint → test (cheapest gate first)

---

## ADR-014: User Lookup — `UserIdentifier` Dual-Field Pattern

**Status:** Accepted
**Date:** 2026-04-25

### Context
ADR-011 established that users must be lookable by `phone` OR `wa_username`. Phase 1 needed a concrete implementation of this in `src/db/users.ts`.

### Decision
All user lookup and creation functions accept a `UserIdentifier` object:

```typescript
export interface UserIdentifier {
  phone?: string;
  waUsername?: string;
}
```

`findUser` queries: `WHERE phone = $1 OR (wa_username IS NOT NULL AND wa_username = $2)`.
`createUser` inserts whichever field is present.
The webhook entry point builds a `UserIdentifier` from the Z-API payload and passes it through the entire call chain.

### Rationale
- Z-API currently always provides `phone`. When WhatsApp @username becomes the primary identifier, only the webhook schema needs a new optional field — no handler or DB changes required.
- Using an object type rather than two optional function parameters is cleaner to extend and impossible to accidentally swap argument positions.
- `exactOptionalPropertyTypes: true` (tsconfig) requires conditional property assignment (`if (x) obj.prop = x`) rather than `{ prop: x ?? undefined }` — the object approach makes this pattern explicit.

### Consequences
- `users.phone` remains `NOT NULL` in the current schema. A migration will be needed when `phone` becomes nullable (when @username becomes the sole identifier). The application layer is already ready for that migration.
