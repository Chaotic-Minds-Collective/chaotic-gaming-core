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
3. Set `STEAM_OPENID_RETURN_URL` to the website's exact Steam callback URL.
4. Run `npm install`.
5. Run `npm run db:migrate` against a non-production database.
6. Run `npm run dev`.

The API listens on `PORT` (default 3001). `GET /health/live` is process liveness; `GET /health/ready` checks PostgreSQL connectivity.

## Administration commands

Create a game server record:

`npm run server:create -- 7dtd "Main Cluster" "7DTD Main" production`

Configure its public connection details:

`npm run server:configure -- <SERVER_UUID> '{"publicHostname":"play.example.net","gamePort":26900,"queryPort":26901,"maxPlayers":50,"mapName":"Navezgane","isListed":true}'`

Create a least-privilege service account:

`npm run service:create -- 7dtd-event-bridge --role game_event_publisher --scope-type server --scope-id <SERVER_UUID>`

Assign additional roles to an existing principal:

`npm run role:assign -- <PRINCIPAL_UUID> reward_worker server <SERVER_UUID>`

Create or update a draft product:

`npm run product:upsert -- '<JSON product definition>'`

Run administration commands only from a trusted environment with a non-production database until the deployment is approved. Service credentials are printed once; store them in the host's secret manager.

## Security baseline

- Never commit credentials, tokens, or production data.
- Store only hashes of opaque session and service credentials.
- Enforce permissions server-side; Discord roles are not platform permissions.
- Steam linking verifies the signed OpenID assertion server-side and rejects nonce replay.
- External account linking must prove ownership; never link by username alone.
- Use least-privilege service identities for each integration.
- Audit authorization-sensitive actions.
- Payment webhooks must be signature-verified and idempotent before granting entitlements.
- Plugin catalogue entries never install or execute plugin code.

## Status

Foundation implementation is committed and CI-tested. External identity linking beyond Steam, account recovery/email verification, payment-provider integration, actual game reward fulfillment, artifact signing/sandboxing and production operations remain incomplete. No production database migrations have been applied and no production service has been deployed.

## Test-mode checkout

Stripe Checkout is disabled by default and accepts test-mode secret keys only. To enable it in an isolated development or staging environment, configure PAYMENTS_ENABLED=true, a Stripe test secret (sk_test_), a webhook signing secret (whsec_), and HTTPS success/cancel URLs. Live keys are rejected by the application.

- GET /commerce/checkout/status reports whether test checkout is configured.
- POST /commerce/orders/:orderId/checkout creates or reuses a Stripe test Checkout session for the authenticated order owner.
- POST /webhooks/stripe verifies the raw-body signature, checks amount and currency, protects against duplicate events, and grants entitlements only after a verified paid event.

The Core API holds the Stripe secret. The website receives only a validated checkout.stripe.com URL. Do not put Stripe credentials in the website environment, commit them, or configure live-mode keys. See docs/commerce/stripe-test-mode.md for setup and webhook details.

## Commerce catalog administration

Catalog management is restricted to the platform-scoped commerce.manage permission. The platform_admin role receives this permission from the base RBAC migration. After a player account has been registered, a database operator can grant the role explicitly with:

```bash
npm run admin:grant -- <PLAYER_PRINCIPAL_UUID>
```

The player principal UUID is displayed on the signed-in account page. See docs/commerce/catalog-management.md for the product, price and per-game delivery mapping API. Do not configure delivery mappings until the target game adapter supports the declared delivery type.
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
