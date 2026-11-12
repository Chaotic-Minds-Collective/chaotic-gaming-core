# Roles and Scoped Permissions

Roles are assigned to a principal at one scope: platform, game, cluster, server or guild. Do not treat Discord role membership as a Core permission.

## Common assignments

- Platform administrator: `platform_admin` at `platform` scope.
- Plugin release manager: `plugin_manager` service identity at `platform` scope.
- Game administrator: `game_admin` at a game key such as `7dtd`.
- Server administrator: `server_admin` at a server UUID.
- Runtime plugin reporter: `plugin_runtime` service identity at a server UUID.
- Heartbeat reporter: `server_heartbeat` service identity at a server UUID.
- Game event publisher: `game_event_publisher` service identity at a server UUID.
- Moderator: `moderator` at a Discord guild ID.
- Support: `support` at an approved platform or narrower scope.

## Assign a role

From a trusted administration environment with the intended non-production `DATABASE_URL`:

`npm run role:assign -- <PRINCIPAL_UUID> server_admin server <SERVER_UUID>`

For a platform administrator, use:

`npm run role:assign -- <PRINCIPAL_UUID> platform_admin platform`

The CLI verifies that the principal and role exist and that game/cluster/server scopes are valid. Treat platform_admin as a break-glass role and assign it sparingly.

## Create service accounts

Example plugin manager:

`npm run service:create -- plugin-registry --role plugin_manager --scope-type platform`

Example server heartbeat agent:

`npm run service:create -- 7dtd-heartbeat --role server_heartbeat --scope-type server --scope-id <SERVER_UUID>`

Example game event bridge:

`npm run service:create -- 7dtd-event-bridge --role game_event_publisher --scope-type server --scope-id <SERVER_UUID>`

Credentials are printed once and stored hashed in the database. Keep the printed secret in the host's secret manager.
