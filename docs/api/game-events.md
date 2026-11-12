# Game Event Ingestion

POST /integrations/servers/{serverId}/events

Requires a service credential with `game_event_publisher` assigned to the exact server scope. A platform-level grant is possible but should not be used for ordinary game adapters.

Payload:

```json
{
  "game": "7dtd",
  "eventId": "provider-event-id",
  "eventType": "player.joined",
  "occurredAt": "2026-11-12T16:00:00.000Z",
  "payload": { "providerPlayerId": "provider-specific-id" }
}
```

Supported normalized event types: `player.joined`, `player.left`, `player.chat`, `server.started`, `server.stopped`, `player.died`.

The event is stored with a unique (server_id, external_event_id) key and a transactional outbox event. Retries with the same ID are acknowledged as duplicates without inserting a second event. Provider-specific event names must be mapped using the exact target server's live API documentation; the Core does not guess source event names.
