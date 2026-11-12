# Chaotic Gaming Core

Shared backend for player identity, authentication, authorization, game/server registry, REST APIs, events and future commerce integrations.

## Current milestone
Foundation service with PostgreSQL migrations, health/readiness endpoints, structured logging, security headers and rate limiting. Authentication and business endpoints remain disabled until enforcement and tests are implemented.

## Requirements
- Node.js 22+
- PostgreSQL 15+
- npm

## Local setup
```bash
cp .env.example .env
npm install
npm run migrate
npm run dev
```
Set `DATABASE_URL` to a disposable development database first. Never point this at production during initial setup.

- Liveness: `GET /health`
- Readiness: `GET /ready` (checks PostgreSQL)

## Architecture
Modular monolith with PostgreSQL schemas for `core`, `community`, `commerce`, `integrations`, `operations`, `games_atlas`, `games_7dtd` and `games_ark`. Discord and website applications integrate over authenticated APIs and do not receive direct database credentials.

## Security
Never commit environment files, tokens, passwords or database credentials. Use isolated development/test databases. Production access requires authentication, authorization, migrations, backups and security review. Game adapters and Discord use separate least-privilege service identities.

This is an early development foundation; no production database is configured by this repository.
