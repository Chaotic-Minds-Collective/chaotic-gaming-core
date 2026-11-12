# 7 Days to Die Data Model

The initial model treats each server as owning one world and keeps player IDs scoped to that server. A central player can link to multiple server-specific game identities. Player events include a provider event ID where available so retries can be deduplicated.

Exact game event names, player identifiers and world metadata must be validated against the target server version and integration mechanism.
