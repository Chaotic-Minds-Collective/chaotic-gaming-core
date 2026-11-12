# Architecture Overview

## System boundaries

- **Core API:** authoritative identity, authorization, platform data, commerce state, event outbox.
- **Website:** player-facing portal and admin interface; calls Core APIs only.
- **Glitch Bot:** independent Discord application; retains standalone community operations during Core outages and calls Core for account-linked operations.
- **Game adapters:** one adapter per game/server family; no direct database access.
- **SDK:** shared versioned API and event contracts.
- **Docs:** architecture decisions, API references, runbooks and game-specific integration notes.

## Initial deployment shape

Start as a modular monolith backed by one PostgreSQL database. Use separate schemas for domains and game-specific records. Do not introduce microservices, Redis or a message broker until measured requirements justify them.

## Trust boundaries

All clients authenticate independently. The Core API authorizes every sensitive request. Discord guild roles do not grant game or platform privileges. Game adapters receive only the permissions required for their assigned servers. Secrets never belong in browser code or game configuration committed to Git.

## Reliability

Business changes and corresponding outbox events are written in one database transaction. Consumers use event IDs for idempotency and retry delivery with backoff. The Discord bot and game servers must tolerate Core downtime.
