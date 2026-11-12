# Chaotic Gaming Core

Shared backend for Chaotic Gaming: identity, authorization, game/server registry, REST APIs, commerce, integrations and durable events.

## Current status

Foundation scaffold. The initial PostgreSQL migration and HTTP health service are being established. Authentication, authorization enforcement, commerce and game adapters are not yet production-ready.

## Requirements

- Node.js 22+
- PostgreSQL 16+
- npm

## Local development

1. Copy `.env.example` to `.env` and configure the database.
2. Run `npm install`.
3. Run `npm run db:migrate` after reviewing the migration.
4. Run `npm run dev`.

## Commands

- `npm run dev` — start the API with tsx.
- `npm run build` — compile TypeScript.
- `npm start` — run compiled output.
- `npm run db:migrate` — apply ordered SQL migrations.
- `npm run typecheck` — type-check without emitting files.

## Safety

Never commit secrets. The API does not contain production credentials. Database migrations must be reviewed and backed up before production use. Do not expose PostgreSQL directly to the public internet.
