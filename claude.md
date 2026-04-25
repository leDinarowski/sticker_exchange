# sticker_exchange — AI Agent Instructions

## Project Overview

**sticker_exchange** is a proximity-based P2P matchmaking engine using World Cup sticker trading over WhatsApp as the initial use case. The real goal is to validate a generic location-based connection engine that can be repurposed for any domain (services, products, marketplaces, etc.).

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js 20 + TypeScript | Strict mode enabled |
| Hosting | Vercel (serverless) | Webhook receiver + API routes |
| WhatsApp | Z-API (managed SaaS) | REST API + native webhooks, no self-hosting |
| Database | Supabase (PostgreSQL + PostGIS) | Geospatial queries via PostGIS, connection pooler required |
| Location privacy | H3 (resolution 8) | Snap coordinates before storage — never store exact GPS |
| ORM | Supabase JS client + raw SQL for geo | No heavy ORM — keep it lean |
| Logging | Pino (structured JSON) | Use `logger.info/warn/error` always |
| Validation | Zod | All external inputs must be validated |
| Testing | Vitest | One test file per feature module |

## Before Starting Any Task

Read these files before planning or writing code — not after:

1. **`decisions.md`** — past architectural choices. Never re-litigate an accepted ADR without a concrete new reason.
2. **`learnings.md`** — experiment results and known gotchas. Check the section relevant to the area you're touching.
3. **`architecture.md`** — data flows, SQL query patterns, and the component diagram. Read before touching anything in the data layer or state machine.
4. **Relevant skill guide in `.claude/skills/`** — listed below. Read before implementing the corresponding feature area.

Available skills:
- `whatsapp-flow` — Z-API call patterns, button message constraints, copy rules
- `state-machine` — state enum, JSONB schema, transition rules, how to add a handler
- `lgpd` — consent recording, PII fields, bilateral consent flow
- `listing-parser` — input formats, range parsing, echo-back, validation rules
- `geospatial` — H3 snapping, ST_DWithin patterns, index requirements

5. **`roadmap.md`** — phase sequencing and inter-phase dependencies. Check when scope is unclear.

## Repository Rules

- **Never commit directly to `main`.** Every change goes through a feature branch + PR.
- Branch naming: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`
- Each PR must include passing tests for the feature it introduces.
- No new feature starts until all existing tests pass (`npm test`).
- PRs are small and focused — one feature per PR.

## File Structure

```
sticker_exchange/
├── api/                  # Vercel serverless entry points (one file = one route)
│   ├── webhook.ts        # POST /api/webhook — receives all Z-API events
│   └── health.ts         # GET  /api/health  — Supabase connectivity check
├── src/
│   ├── handlers/         # One handler per conversation intent
│   ├── services/         # Business logic (matching, location, listings)
│   ├── db/               # Supabase queries (typed)
│   ├── state/            # Conversation state machine
│   ├── utils/            # Shared helpers (logger, validation, h3, etc.)
│   └── types/            # Shared TypeScript types
├── tests/
│   └── <feature>/        # Mirror of src/ structure
├── supabase/
│   └── migrations/       # SQL migration files — never modify existing files
├── .claude/
│   └── skills/           # Project-specific AI agent skill guides
├── public/               # Required by Vercel for API-only deployments
├── .env.example
├── vercel.json
└── package.json
```

## Environment Variables

Always check `.env.example` for the full list. Never hardcode secrets. Never commit `.env`.
Always use the Supabase **connection pooler URL** (`SUPABASE_DB_POOLER_URL`), not the direct DB URL, for all Vercel function connections.

## Database Migrations

- **Never modify an existing migration file.** Always create a new one.
- Naming: `YYYYMMDDHHmmss_<slug>.sql` — use `npm run migrate` to apply.
- Every schema change (new column, new index, drop) requires its own migration file.

## Coding Conventions

- All functions must have explicit TypeScript return types.
- Use `Result<T, E>` pattern (via `neverthrow`) for error handling — no unhandled promise rejections.
- All database queries must be typed — use Supabase's generated types.
- Every external input (webhook payload, user message) must pass through a Zod schema before use.
- Logging: use structured logs with `{ userId, event, ... }` fields. Never log raw phone numbers in production.
- Location data: **never log or expose exact user coordinates** — apply H3 snapping before storage, query only via distance functions, never return coordinates to any client.

## WhatsApp Message Design Rules

- All user-facing copy must use button messages (Z-API `buttons` or `list` message types) wherever a choice is presented. Never ask users to type a keyword.
- No emojis anywhere in message copy.
- Button labels: max 20 characters, direct and action-oriented.
- Body text: concise. Prefer 1-2 short sentences over long explanations.
- See `.claude/skills/whatsapp-flow/SKILL.md` for Z-API call patterns.

## Conversation State Machine

User sessions are stateful over WhatsApp. Each user row in the DB has a `conversation_state` JSONB field.

States:
- `NEW` → `ONBOARDING_NAME` → `ONBOARDING_TERMS` → `ONBOARDING_LOCATION` → `ONBOARDING_RADIUS` → `ONBOARDING_LISTINGS` → `IDLE`
- `IDLE` → `BROWSING` (discovery board shown)
- `IDLE` → `CONFIRMING_INVENTORY` (pre-expiry nudge sent)
- `BROWSING` → `AWAITING_MATCH_RESPONSE` (connection request sent to target)

When implementing a new handler, always read the current state first and transition explicitly after success.
See `.claude/skills/state-machine/SKILL.md` for patterns.

## Domain Generalization

The engine is domain-agnostic. Domain-specific data is stored in `listings` and `wanted_listings` tables with a `domain` field and a `payload JSONB` column. Never hard-code sticker-specific logic outside of the sticker domain module.

## Testing Strategy

- Unit tests: pure functions (state transitions, matching logic, listing parser, message formatting)
- Integration tests: database queries against a Supabase local dev instance
- No tests should call the real Z-API — mock all outbound WhatsApp calls
- Run `npm test` before every PR

## Sensitive Data Reminders

- Phone numbers are PII under LGPD — treat them as secrets
- `wa_username` is also PII — same treatment as phone
- Location is sensitive PII — H3-snap before storage, never expose coordinates
- Consent must be recorded in DB (`consented_at`) before any data is stored
- Both parties must give explicit consent before a WhatsApp group is created
- See `.claude/skills/lgpd/SKILL.md` for full compliance checklist

## Task Tracking

- When completing any item from `TODO.md`, mark it `[DONE — YYYY-MM-DD]` in the same commit as the implementation.
- Never leave a completed item as `[ ]`.
- Never delete items — move them to DONE with the date.

## Architecture Decisions & Gotchas

- All non-obvious architectural decisions and tooling gotchas go in `decisions.md` as a new ADR.
- Add an ADR when: choosing between approaches with trade-offs, discovering a non-obvious bug or incompatibility, or making a decision that would surprise a future reader.
- Follow the existing ADR format: Status, Date, Context, Decision, Rationale.
- Routine implementation details (adding a field, writing a handler) do not need an ADR.

## Learnings

- When an experiment completes, a surprise occurs, an assumption is invalidated, or a non-obvious bug is fixed — add an entry to `learnings.md`.
- Follow the existing format: Hypothesis / Question → Observation → Impact → Action.
- Link to the relevant ADR if the learning changes or confirms a past decision.

## Commands

```bash
npm run dev          # Start local dev (tsx watch)
npm test             # Run all tests
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run migrate      # Run Supabase migrations
```
