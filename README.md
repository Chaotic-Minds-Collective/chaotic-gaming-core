# Chaotic Gaming Core

The shared platform backend for Chaotic Gaming. This repository is the source of truth for player identity, authentication, scoped authorization, platform APIs, commerce entitlements, integration events, and operational records.

## Architecture

- Node.js 22+ and TypeScript
- Fastify REST API
- PostgreSQL with versioned SQL migrations
- Modular monolith; modules remain separable by domain
- Database-backed transactional outbox for reliable integration events
- Game-specific data belongs in dedicated PostgreSQL schemas
- Discord bot, website, and game adapters authenticate as separate clients

## Local development

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run `npm install`.
4. Run `npm run db:migrate` after configuring the database.
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

Foundation scaffold. Authentication flows, authorization middleware, commerce, game adapters, and production deployment are subsequent milestones.
