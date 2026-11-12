# Foundation architecture

## Runtime boundaries

- Core is a modular monolith. Domain modules share one deployment unit and one PostgreSQL cluster initially.
- The Discord bot, public website and game adapters are independent clients of Core APIs.
- Clients never receive database credentials and never connect directly to PostgreSQL.
- Game-specific records live in dedicated PostgreSQL schemas; shared identity and authorization live in `core`.

## Identity and authorization

- `core.principals` represents both human users and service identities.
- `core.users` and `core.service_accounts` specialize principals.
- External provider IDs are stored as text and are unique per provider while linked.
- Linking requires provider-side proof of ownership. Usernames are display metadata, never proof.
- Role assignments carry explicit scopes. Discord roles do not implicitly grant game-administration permissions.
- Session and service credentials are stored as hashes, never plaintext.

## Events

Domain writes and outbox inserts must occur in the same database transaction. Consumers use event IDs as idempotency keys. Delivery is retried with bounded exponential backoff and dead-letter visibility.

## Security boundaries

- No secrets in source control.
- Service credentials are separate per application and rotatable.
- Sensitive actions fail closed when authorization cannot be established.
- Production and non-production environments must use separate credentials and databases.
- Audit records must not include passwords, raw tokens, payment data or unnecessary personal information.

## Initial schemas

`core`, `community`, `commerce`, `integrations`, `operations`, `games_atlas`, `games_7dtd`, and `games_ark`.

These schemas are namespaces in one PostgreSQL database initially, not separate database instances.
