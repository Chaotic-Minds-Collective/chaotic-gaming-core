# Service Integration API

## Service credentials

Create a service identity from a trusted administrative environment:

`npm run service:create -- <application-name>`

The command prints a high-entropy credential once. Store it in the integration's secret manager/environment and do not commit it. New service accounts receive no permissions by default.

For a game status reporter such as Glitch Bot, assign the `server_heartbeat` role with `scope_type='server'` and `scope_id=<server UUID>`. This grants only `servers.heartbeat`, not server administration. Game adapters that need administrative capabilities must receive separately reviewed roles.

## Server heartbeat

`POST /integrations/servers/{serverId}/heartbeat`

Header: `Authorization: Bearer cg_srv_<credential>`

Body:

```json
{
  "game": "7dtd",
  "serverVersion": "exact-server-build",
  "adapterVersion": "0.1.0",
  "online": true,
  "playerCount": 0
}
```

Requires `servers.heartbeat` for the exact server scope or a platform-level grant. The server must exist and its game key must match. Heartbeats are append-only records; the latest received record is the current observed status.

## Security notes

- Use a distinct service identity per bot, adapter, and environment.
- Rotate credentials by issuing a second credential, updating the integration, then revoking the old one.
- Never embed service credentials in browser code or public game client files.
- Core authorization is independent of Discord guild roles.
