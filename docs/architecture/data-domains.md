# Data Domains

The initial PostgreSQL database uses schemas to keep domain ownership explicit.

| Schema | Responsibility |
|---|---|
| `core` | Principals, player accounts, linked identities, roles, permissions, games, clusters and servers |
| `community` | Discord guilds, member mappings, tickets, moderation and suggestions |
| `commerce` | Products, price snapshots, orders, verified payments, entitlements, wallet ledger and reward delivery |
| `operations` | Audit trail, migrations, heartbeats, event outbox and background jobs |
| `integrations` | External provider mappings and webhook receipts |
| `games_atlas` | ATLAS maps, characters, tribes, sessions and transfers |
| `games_7dtd` | 7 Days to Die worlds, players, sessions and game events |
| `games_ark` | ARK survivors, maps, tribes, sessions and transfers |

A payment transaction is not an entitlement. A successful, verified payment is reconciled first; entitlements are then granted idempotently. A game reward is separately queued and confirmed by the relevant adapter. Wallet ledger entries are append-only and balances are derived from ledger history.
