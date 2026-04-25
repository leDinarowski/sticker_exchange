---
name: security
description: "Use this skill before every PR and whenever writing code that touches env vars, webhook handlers, authentication, user data, or external API calls. Covers secret scanning, credential leakage patterns, webhook verification, Supabase key safety, and the pre-PR security checklist."
---

# Security — sticker_exchange

## Secret Surface Map

All secrets in this project. Every one must come from environment variables — never hardcoded.

| Secret | Env Var | Where It's Used | If Leaked |
|---|---|---|---|
| Z-API instance ID | `ZAPI_INSTANCE_ID` | All outbound Z-API calls | Attacker can send WhatsApp messages as the bot |
| Z-API token | `ZAPI_TOKEN` | All outbound Z-API calls | Same as above |
| Z-API security token | `ZAPI_SECURITY_TOKEN` | Webhook verification header | Attacker can forge inbound webhooks |
| Supabase URL | `SUPABASE_URL` | DB client init | Low risk alone — needs a key too |
| Supabase anon key | `SUPABASE_ANON_KEY` | Public client (if used) | Limited by RLS; avoid server-side use |
| Supabase service role key | `SUPABASE_SERVICE_ROLE_KEY` | DB client init (server-side only) | Full DB access — highest severity |
| Supabase pooler URL | `SUPABASE_DB_POOLER_URL` | Raw SQL connections | Contains credentials in the URL |
| Webhook secret | `WEBHOOK_SECRET` | Incoming webhook auth | Attacker can replay/forge Z-API events |

---

## Pre-Push Secret Scan (Run Before Every Commit)

Manually scan staged changes for these patterns before `git commit`:

```bash
# Check staged diff for common secret patterns
git diff --staged | grep -iE \
  "(token|secret|key|password|credential|api_key|bearer|authorization)" \
  | grep -v "process\.env\|env\.example\|SKILL\.md\|decisions\.md"
```

Any match in a `.ts` or `.js` file that is **not** `process.env['...']` is a leak. Fix before committing.

**Never-commit list:**
- `.env` and any `.env.*` variant (except `.env.example`)
- Any file containing a raw token/key string
- `supabase/.branches/` — may contain local state
- `node_modules/`

Verify `.gitignore` covers all of the above before adding a new secret-bearing file.

---

## Webhook Authentication (Mandatory)

Every request to `POST /api/webhook` must be verified before any processing begins. Z-API sends `ZAPI_SECURITY_TOKEN` in the request header.

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger';

function verifyWebhookSecret(req: VercelRequest): boolean {
  const incomingToken = req.headers['client-token'];
  const expectedToken = process.env['ZAPI_SECURITY_TOKEN'];
  if (!expectedToken) {
    logger.error({ event: 'webhook_secret_missing' });
    return false;
  }
  return incomingToken === expectedToken;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    logger.warn({ event: 'webhook_unauthorized' });
    res.status(401).json({ ok: false });
    return;
  }
  // proceed
}
```

Never process webhook payloads before this check passes. Unauthenticated requests must be rejected with 401 and logged (without the payload body).

---

## Supabase Key Rules

```typescript
// WRONG — anon key has limited access via RLS; service role bypasses all RLS
// Using anon key server-side gives false security
import { createClient } from '@supabase/supabase-js';
const client = createClient(url, process.env['SUPABASE_ANON_KEY']!); // never do this server-side

// CORRECT — service role key for all server-side DB operations
const client = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

- `SUPABASE_SERVICE_ROLE_KEY` is **server-side only** — never expose it to the browser or return it in any response
- `SUPABASE_DB_POOLER_URL` contains credentials in the URL string — never log it, never include it in error messages
- The Supabase client is initialized once in `src/db/client.ts` and imported everywhere — never re-initialize it with hardcoded values

---

## Logging Rules (Secrets & Credentials)

```typescript
// WRONG — logs the env var value
logger.info({ apiKey: process.env['ZAPI_TOKEN'], event: 'zapi_call' });

// WRONG — logs the full webhook payload (contains phone number + token)
logger.info({ payload: req.body, event: 'webhook_received' });

// WRONG — error messages sometimes include connection strings
logger.error({ error: err.message }); // if err came from a DB connection, message may include the URL

// CORRECT — log intent, not credentials
logger.info({ event: 'zapi_call', instanceId: process.env['ZAPI_INSTANCE_ID'] }); // ID is low-risk
logger.info({ event: 'webhook_received', messageType: payload.message.type, userId: user.id });
logger.error({ event: 'db_connection_failed', message: 'Connection pool error' }); // sanitized
```

Never log:
- Any env var value that is a token, key, or password
- Raw webhook request bodies (contain phone numbers)
- Full error messages from DB connections (may include connection string)
- `SUPABASE_DB_POOLER_URL` in any form

---

## Parameterized Queries (No SQL Injection)

The Supabase JS client parameterizes `.select()`, `.insert()`, `.update()` automatically. Raw SQL (used for geospatial queries) must always use parameters:

```typescript
// WRONG — string interpolation in SQL
const { data } = await supabase.rpc('nearby_users', {
  query: `ST_DWithin(location, ST_MakePoint(${lng}, ${lat}), ${radius})` // injection risk
});

// CORRECT — parameterized RPC or tagged query
const { data } = await supabase
  .rpc('nearby_users', { lat, lng, radius_m: radius });

// CORRECT — if writing raw SQL via pg client, always use $1 $2 placeholders
await pool.query(
  'SELECT * FROM users WHERE ST_DWithin(location::geography, ST_MakePoint($1, $2)::geography, $3)',
  [lng, lat, radius]
);
```

---

## Environment Variable Access Pattern

```typescript
// WRONG — direct access, silent undefined in production
const token = process.env.ZAPI_TOKEN;

// CORRECT — bracket notation + explicit undefined check at startup
const token = process.env['ZAPI_TOKEN'];
if (!token) throw new Error('ZAPI_TOKEN is required');
```

All required env vars must be checked at module initialization time (not per-request). Use the pattern already established in `src/db/client.ts`. Any new env var added to code must also be added to `.env.example` with a blank value and a comment.

---

## Pre-PR Security Checklist

Run this before opening any PR. Failures block the PR.

**Secrets**
- [ ] `git diff --staged` contains no hardcoded tokens, keys, or passwords
- [ ] No new env var used in code without a corresponding blank entry in `.env.example`
- [ ] `.env` file not staged (`git status` shows it as untracked or ignored)

**Webhook handler**
- [ ] `POST /api/webhook` verifies `ZAPI_SECURITY_TOKEN` before processing the body
- [ ] Unauthorized requests return 401 and are logged without the payload body

**Logging**
- [ ] No `process.env['..._KEY']` or `process.env['..._TOKEN']` values appear in any log call
- [ ] No raw webhook payload or request body logged
- [ ] No DB connection strings appear in error messages

**Database**
- [ ] All raw SQL uses `$1`, `$2` placeholders — no string interpolation
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is only used in `src/db/client.ts`, never re-initialized elsewhere

**Data exposure**
- [ ] No API route returns `phone`, `wa_username`, or `location` coordinates to any client
- [ ] No internal UUID or DB row is returned that was not explicitly intended for the caller

**Dependencies**
- [ ] Any new `npm install` package has been checked for known vulnerabilities (`npm audit`)
- [ ] No package with an unusual permission scope (filesystem, network, spawn) added without review
