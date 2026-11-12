# Game Reward Delivery API

A reward is created only after the Core has granted a valid entitlement. A pending order or browser redirect does not create a deliverable reward.

## Claim

`POST /integrations/servers/{serverId}/rewards/claim`

Requires a `reward_worker` service identity scoped to the exact server.

Request:

```json
{ "limit": 10 }
```

The Core claims up to 100 available rewards in a transaction, increments attempts, and grants a two-minute lease to the service identity. Expired processing leases can be reclaimed.

## Acknowledge

`POST /integrations/servers/{serverId}/rewards/{rewardId}/ack`

Success:

```json
{ "outcome": "delivered", "response": { "providerReceipt": "game-specific-reference" } }
```

Failure:

```json
{ "outcome": "failed", "error": "The game server rejected the grant." }
```

Failed attempts are retained and retried with exponential backoff capped at one hour. Acknowledgements must come from the service identity holding the active lease. Duplicate successful acknowledgements are idempotent.

## Service account

`npm run service:create -- 7dtd-reward-worker --role reward_worker --scope-type server --scope-id <SERVER_UUID>`

## Delivery boundary

These endpoints manage durable queue state. They do not themselves grant items inside a game. The adapter must validate the target identity, invoke a game-version-specific delivery method, and acknowledge success only after the game confirms the grant. Refund/revocation reconciliation is a separate workflow.
