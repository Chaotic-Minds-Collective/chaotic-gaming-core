# Chaotic Gaming Core

The shared platform backend for Chaotic Gaming. This repository owns player identity, authentication, scoped authorization, platform APIs, durable events and integrations.

## Architecture
- TypeScript / Node.js modular monolith.
- PostgreSQL as the system of record.
- REST API for the website, Glitch Bot and game adapters.
- Database-backed transactional outbox for reliable asynchronous events.
- Separate game-specific modules and schemas; no direct database credentials in bots or game plugins.

## Development
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:d83ff37a1642a45c4a8f53f3cb59a97e39ac8e8d53e20c437e5eeb4db1713baa -->

1. Use Node.js 22 or newer.

<!-- /coderabbit-ai-generated:v1 -->
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
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:458c28d158bc356ad2fe533bda02866dd7ae30f03984eab54fef605e7300182b -->

The migrations establish identity, linked accounts, sessions, RBAC, service credentials, audit logs, an event outbox and idempotency records. The API includes authentication, Steam and Discord account linking, server management, player identity resolution, commerce, rewards, game events and plugin persistence.

<!-- /coderabbit-ai-generated:v1 -->
## Discord account linking

Discord linking uses the existing Core OAuth2 authorization-code flow. The website calls `POST /auth/discord-link/challenge` through its server-side session proxy, relays the short-lived binding cookie in an HttpOnly website cookie, and forwards the Discord callback to Core's `GET /auth/discord-link/callback` endpoint. The Core callback URL remains internal; Discord's registered redirect URI is the website BFF endpoint.

Configure `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URL` and `DISCORD_LINK_COMPLETE_URL` together. Register this exact redirect URI in the Discord Developer Portal:

`https://www.chaoticmindsgaming.com/api/account/link/discord/callback`

The completion URL should point to the website's `/account` page. The flow requests only the `identify` scope, verifies a one-time state challenge and session binding, and does not persist Discord access tokens.
