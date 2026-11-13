# Game Event Ingestion

`POST /integrations/servers/{serverId}/events`

Requires a service credential with `game_event_publisher` assigned to the exact server scope. A platform-level grant is possible but should not be used for ordinary game adapters.

Payload:

```json
{
  "game": "atlas",
  "eventId": "provider-event-id",
  "eventType": "character.transferred",
  "occurredAt": "2026-11-12T16:00:00.000Z",
  "scope": {
    "clusterId": "Core cluster UUID",
    "gridId": "provider-grid-id",
    "serverId": "Core server UUID"
  },
  "correlationId": "transfer-operation-id",
  "payload": { "providerCharacterId": "provider-specific-id" }
}
```

`scope` is optional for backwards compatibility with existing adapters. When supplied, `clusterId` and `serverId` must match the registered server; `gridId` is the provider's non-empty grid identifier (maximum 200 characters). Core derives and persists the authoritative cluster and server IDs from its server registry. `correlationId` is optional, may be null, and is limited to 200 characters.

Supported normalized event types: `player.joined`, `player.left`, `player.chat`, `player.died`, `player.killed`, `character.created`, `character.transferred`, `tribe.created`, `tribe.member.joined`, `tribe.member.left`, `tribe.updated`, `chat.global`, `chat.tribe`, `ship.sunk`, `ship.retrieved`, `structure.destroyed`, `tame.created`, `tame.died`, `server.started`, `server.stopped`, `server.state.changed`.

Provider-specific event names must be mapped using the exact target server's live API documentation; Core does not guess source event names. Provider IDs belong in the payload as strings. The endpoint accepts a JSON object payload and is subject to the API's 1 MiB request-body limit.

Events are stored with the unique `(server_id, external_event_id)` key and a transactional outbox event. Retries with the same ID are acknowledged as duplicates without inserting a second event or outbox record. The outbox payload includes the authoritative Core cluster/server scope, provider grid ID, and correlation ID when supplied.

Legacy adapters may omit `scope` and `correlationId`; newly implemented adapters should send them so cross-grid routing and tracing remain explicit. This API contract does not imply that native ATLAS callbacks or live server integration have been verified.
