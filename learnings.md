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
