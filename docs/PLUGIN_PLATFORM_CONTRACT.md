# Plugin Platform Contract

## Responsibilities
Chaotic Gaming Core owns plugin registration, compatibility metadata, scoped service identities, permission evaluation, configuration versions, health records, audit records, and event delivery. Game plugins do not receive database credentials.

## Runtime model
- Plugins execute in game-specific adapters or external integration workers.
- Core exposes authenticated REST endpoints.
- The event outbox provides durable at-least-once delivery; consumers must be idempotent.
- A game adapter may continue safe local operation when Core is unavailable. Commerce, rewards and privileged actions fail closed.
- Plugin enablement and configuration are scoped to environment, game, cluster and server.

## Illustrative plugin manifest
```json
{
  "id": "com.chaoticgaming.atlas.server-health",
  "name": "Server Status & Health",
  "version": "0.1.0",
  "game": "atlas",
  "apiVersion": "1",
  "dependencies": [],
  "capabilities": ["server.health.read"],
  "permissions": ["server.status.read"],
  "configSchema": {},
  "compatibility": {
    "gameBuilds": [],
    "serverApi": [],
    "operatingSystems": []
  }
}
```
This sample is illustrative, not a validated ATLAS loader manifest.

## Lifecycle
```text
DISCOVERED -> VALIDATED -> ENABLED -> HEALTHY
                         |             |
                         v             v
                      DISABLED <--- DEGRADED
                         |
                         v
                      REMOVED
```

- Validate signatures/checksums, manifest schema, dependencies and compatibility before enablement.
- Apply config changes atomically and retain the previous version for rollback.
- Emit lifecycle events and audit every privileged configuration change.
- Never auto-install or auto-upgrade a plugin on a production server without an explicit deployment policy.

## Initial proposed API surface
- GET /v1/plugins — list visible plugins and compatibility metadata.
- GET /v1/servers/{serverId}/plugins — installed plugin state.
- POST /v1/servers/{serverId}/plugins/{pluginId}/enable — request enablement.
- POST /v1/servers/{serverId}/plugins/{pluginId}/disable — request disablement.
- GET /v1/servers/{serverId}/plugins/{pluginId}/health — health and version.
- GET /v1/servers/{serverId}/plugins/{pluginId}/config — effective config.
- PUT /v1/servers/{serverId}/plugins/{pluginId}/config — validate and version config.
- POST /v1/integrations/{game}/events — authenticated game event intake.

These are proposed contracts, not deployed endpoints. Every route requires scoped authorization, request validation, audit logging and rate limiting.
