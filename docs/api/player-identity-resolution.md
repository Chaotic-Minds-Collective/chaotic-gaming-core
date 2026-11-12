# Verified Player Identity Resolution

Game adapters must never assume that a Steam ID, character name or game display name is the Chaotic Gaming account ID.

## Resolve

`POST /integrations/servers/{serverId}/players/resolve`

Requires a server-scoped service identity with `players.resolve` permission.

Request:

```json
{
  "provider": "steam",
  "externalId": "76561198000000000"
}
```

Linked response:

```json
{
  "data": {
    "linked": true,
    "principalId": "internal-player-uuid",
    "username": "player-name",
    "displayName": "Player"
  }
}
```

Unlinked, unverified, suspended or missing identities return only `{ "data": { "linked": false } }`. The endpoint does not create accounts or link identities. Linking must happen through a separate proof-of-ownership flow.

Use the internal `principalId` to associate game events with a Chaotic Gaming player. Continue to retain the original provider and external ID for reconciliation.
