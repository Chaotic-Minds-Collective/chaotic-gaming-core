# Game Server Registry

## Register a server

`npm run server:create -- <atlas|7dtd|ark> <cluster-name> <server-name> [development|test|staging|production]`

The command creates the Core server record in an offline state and prints the server UUID. It does not provision a machine, open ports or start a game server.

## Configure a public endpoint

`npm run server:configure -- <SERVER_UUID> '<JSON configuration>'`

Example:

```json
{
  "publicHostname": "play.example.net",
  "gamePort": 26900,
  "queryPort": 26901,
  "maxPlayers": 50,
  "mapName": "The Island",
  "isListed": true
}
```

Only public connection metadata is stored in this record. RCON passwords, game API tokens and service credentials must remain in the game host's secret store. The public `GET /servers` endpoint returns connection metadata only when `isListed` is true and the server belongs to the production environment.

## Heartbeats

The assigned server adapter or configured Glitch Bot status monitor reports heartbeats using a server-scoped service identity. A heartbeat older than five minutes is displayed as offline. The registry does not imply that a server is provisioned or online.
