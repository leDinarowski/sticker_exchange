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
