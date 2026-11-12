# Chaotic Gaming Core

Shared Chaotic Gaming platform core: player identity, authentication, scoped authorization, REST APIs, PostgreSQL migrations, commerce, events and integrations.

## Platform architecture

- Node.js 22+ and TypeScript
- Fastify REST API
- PostgreSQL with versioned SQL migrations
- Modular monolith with separate domain and game schemas
- Transactional event outbox
- Independent website, Discord bot and game adapters using authenticated APIs

## Identity integrations

- Username/password accounts use Argon2id and opaque, hashed sessions.
- Steam linking verifies the OpenID assertion server-side and rejects nonce replay.
- Discord linking uses the OAuth2 authorization-code flow with a one-time, server-generated state challenge, the minimal `identify` scope, issuer validation and server-side token exchange.
- Discord access tokens are used only to fetch the verified user identity, then revoked best-effort; they are never stored.
- External accounts already linked to another Chaotic Gaming principal cannot be silently reassigned or merged.

To enable Discord linking, configure `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET` and `DISCORD_OAUTH_REDIRECT_URI`. Register the exact redirect URI in the Discord Developer Portal. The website callback page must pass the returned `code`, `state` and `iss` to `POST /auth/linked-accounts/discord` using the signed-in player's Core session.

## Plugin ecosystem

The Core owns the shared plugin lifecycle and registry foundation. Game-specific plugins remain independently versioned and communicate with Core through scoped service identities; they never receive database credentials.

See the [central plugin catalogue and ecosystem documentation](https://github.com/Chaotic-Minds-Collective/chaotic-gaming-docs/tree/main/plugins).

## Local development

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Set `STEAM_OPENID_RETURN_URL` to the website's exact Steam callback URL.
4. Set the Discord OAuth2 variables only when the Discord application and redirect URL are configured.
5. Run `npm install`.
6. Run `npm run db:migrate` against a non-production database.
7. Run `npm test`.
8. Run `npm run dev`.

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
- Discord linking verifies state and issuer, uses only `identify`, and does not persist OAuth tokens.
- External account linking must prove ownership; never link by username alone.
- Use least-privilege service identities for each integration.
- Audit authorization-sensitive actions.
- Payment webhooks must be signature-verified and idempotent before granting entitlements.
- Plugin catalogue entries never install or execute plugin code.

## Status

Foundation implementation is committed and CI-tested. Discord account linking is implemented behind optional OAuth2 configuration; the website callback page and Discord Developer Portal redirect registration remain required before activation. Payment-provider integration, actual game reward fulfillment, artifact signing/sandboxing and production operations remain incomplete. No production database migrations have been applied and no production service has been deployed.
