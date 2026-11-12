# Public Server Status API

`GET /servers`

Returns only production-environment servers that have not been deleted. Each result includes the game, cluster, server name, configured status, last heartbeat, and latest player count.

A heartbeat older than five minutes is treated as stale: `online` is false and `playerCount` is null. This avoids showing stale data as live. Development and test servers are never exposed through this endpoint.

No server is shown until it has been explicitly registered in Core with `environment='production'`.
