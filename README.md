# Chaotic Gaming Core

Shared Chaotic Gaming platform core: player identity, authentication, scoped authorization, REST APIs, PostgreSQL migrations, commerce, events and integrations.

## Platform architecture

- Node.js 22+ and TypeScript
- Fastify REST API
- PostgreSQL with versioned SQL migrations
- Modular monolith with separate domain and game schemas
- Transactional event outbox
- Independent website, Discord bot and game adapters using authenticated APIs

## Plugin ecosystem

The Core also owns the shared plugin lifecycle and registry foundation. Game-specific plugins remain independently versioned and communicate with Core through scoped service identities; they never receive database credentials.

See the [central plugin catalogue and ecosystem documentation](https://github.com/Chaotic-Minds-Collective/chaotic-gaming-docs/tree/main/plugins).

## Local development

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run `npm install`.
4. Run `npm run db:migrate` against a non-production database.
5. Run `npm run dev`.

The API listens on `PORT` (default 3001). `GET /health/live` is process liveness; `GET /health/ready` checks PostgreSQL connectivity.

## Database

Migrations are in `migrations/` and are applied in filename order. The migration runner records applied files in `operations.schema_migrations`. Back up databases before applying migrations. Never point local development at production.

## Security baseline

- Never commit credentials, tokens, or production data.
- Store only hashes of opaque session and service credentials.
- Enforce permissions server-side; Discord roles are not platform permissions.
- Verify external account ownership before linking.
- Use least-privilege service identities for each integration.
- Audit authorization-sensitive actions.
- Payment webhooks must be signature-verified and idempotent before granting entitlements.

## Status

Foundation implementation is committed, but authentication hardening, external identity linking, event consumers, payment integration, game fulfillment workers and production operations remain incomplete. No database migrations have been applied and no production service has been deployed.
