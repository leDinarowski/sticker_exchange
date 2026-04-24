# sticker_exchange

A proximity-based P2P matchmaking engine. Initial use case: World Cup sticker trading over WhatsApp.

> The engine is domain-agnostic — see `architecture.md` for the extensibility model.

## Quick Links

- [Architecture](./architecture.md)
- [Architecture Decision Records](./decisions.md)
- [Prioritized Backlog](./TODO.md)
- [Learnings Log](./learnings.md)
- [AI Agent Instructions](./claude.md)

## Tech Stack

- **WhatsApp**: Evolution API (self-hosted, Railway)
- **Backend/Webhook**: Vercel serverless (TypeScript)
- **Database**: Supabase (PostgreSQL + PostGIS)
- **Testing**: Vitest
- **Logging**: Pino (structured JSON)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env.local
# Fill in values — see comments in .env.example

# 3. Run DB migrations
npm run migrate

# 4. Start local dev
npm run dev

# 5. Run tests
npm test
```

## Branch Strategy

- `main` is protected — no direct commits.
- Feature branches: `feat/<slug>`, bug fixes: `fix/<slug>`.
- Every PR requires passing CI (typecheck + lint + tests).
- See `TODO.md` for the current phase and open tasks.

## License

Private — not licensed for redistribution.
