# Game Event Outbox Delivery API

Core stores normalized game events and their `game.event.received` outbox records in the same transaction. These endpoints let a server-scoped service consume those records without exposing unrelated outbox traffic.

## Claim

`POST /integrations/servers/{serverId}/events/claim`

Requires a service credential with the `game_event_consumer` role assigned to the exact server scope.

Request:

```json
{ "limit": 25, "leaseSeconds": 120 }
```

Both fields are optional. The claim limit defaults to 25 and is bounded from 1 to 100. Lease duration defaults to 120 seconds and is bounded from 15 to 300 seconds.

Core claims only unprocessed `game.event.received` records whose payload `serverId` matches the requested server. Rows are ordered by outbox occurrence time and ID, locked with PostgreSQL `FOR UPDATE SKIP LOCKED`, and assigned to the authenticated service principal. Each claimed row receives a fresh, per-event UUID lease token and expiry. Expired leases can be reclaimed; concurrent workers do not block one another.

The response includes the outbox event ID, event type, aggregate metadata, payload, occurrence time, attempt count, lease token, and lease expiry. Treat the lease token as a secret and do not log it.

## Acknowledge

`POST /integrations/servers/{serverId}/events/{eventId}/ack`

Request after successful processing:

```json
{ "leaseToken": "lease-token-from-claim", "outcome": "delivered" }
```

Request after a retryable processing failure:

```json
{ "leaseToken": "lease-token-from-claim", "outcome": "failed", "error": "Temporary downstream failure" }
```

Acknowledgements require the same service principal and active per-event lease token that claimed the row. Expired, replaced, or mismatched leases return `409 EVENT_LEASE_INVALID`. Successful acknowledgement sets `processed_at`; repeated successful acknowledgements are idempotent. Failure releases the lease and makes the event available again using exponential backoff capped at one hour. Attempts and the latest error remain on the outbox row.

## Service account

```sh
npm run service:create -- atlas-event-consumer --role game_event_consumer --scope-type server --scope-id <SERVER_UUID>
```

The role grants only `events.claim` and `events.ack`. A platform-level assignment is technically supported by Core's authorization helper but is not recommended for game adapters.

## Delivery boundary

This is an at-least-once delivery contract, not exactly-once processing. Consumers must use the stable outbox event ID as their idempotency key and make downstream side effects idempotent. A consumer crash after processing but before acknowledgement can cause redelivery after lease expiry. Core does not infer provider callbacks, route chat to Discord, or perform game-state mutations.
