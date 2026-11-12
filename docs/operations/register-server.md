# Register a Game Server and Its Adapter Identity

Run these commands only from a trusted administration environment with `DATABASE_URL` pointing to the intended non-production Core database.

## 1. Apply migrations

`npm run db:migrate`

## 2. Register a server

Example for a development 7 Days to Die server:

`npm run server:create -- 7dtd "Development Cluster" "7DTD Development" development`

The command prints the server UUID. Use that exact UUID in the adapter's `CORE_SERVER_ID`.

## 3. Create a least-privilege service account

`npm run service:create -- 7dtd-adapter --role server_heartbeat --scope-type server --scope-id <SERVER_UUID>`

The command prints the credential once. Store it in the server's secret environment as `CORE_API_SERVICE_TOKEN`. It cannot be retrieved from the database later.

## 4. Configure the adapter

Set `CORE_API_BASE_URL`, `CORE_API_SERVICE_TOKEN`, `CORE_SERVER_ID`, `GAME_SERVER_VERSION`, `TELNET_HOST`, `TELNET_PORT` and `TELNET_PASSWORD`.

Do not expose Telnet to the public internet. Prefer loopback or a VPN/private network.

## 5. Verify

Run the adapter tests, start the heartbeat agent, and check the Core `/servers` endpoint. Do not change a production server's environment or enable public listing until the integration is verified.
