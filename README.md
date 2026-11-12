# Chaotic Gaming Core

The shared platform backend for Chaotic Gaming. This repository owns player identity, authentication, scoped authorization, platform APIs, durable events and integrations.

## Architecture
- TypeScript / Node.js modular monolith.
- PostgreSQL as the system of record.
- REST API for the website, Glitch Bot and game adapters.
- Database-backed transactional outbox for reliable asynchronous events.
- Separate game-specific modules and schemas; no direct database credentials in bots or game plugins.

## Development
1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run `npm install`.
4. Run `npm run db:migrate` to apply SQL migrations.
5. Run `npm run dev`.

## Security
- Never commit secrets or real credentials.
- Use TLS for database and service connections.
- Store only hashes of session/service tokens.
- Use least-privilege service identities and scoped permissions.
- Keep production credentials and data out of development/test environments.

## Current scope
The initial migration establishes identity, linked accounts, sessions, RBAC, service credentials, audit logs, an event outbox and idempotency records. Authentication flows and business APIs are added in subsequent milestones.