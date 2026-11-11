# Core Plugin Registry

Initial metadata and lifecycle foundation for the Chaotic Gaming plugin ecosystem.

## Included
- Manifest validation for stable IDs, semantic versions, supported game targets, dependencies, capabilities, permissions and compatibility metadata.
- In-memory registry with lifecycle transitions and dependency checks.
- Automated tests using Node's built-in test runner.

## Lifecycle safety
This package tracks metadata and state only. It does not dynamically import, execute, install, upgrade or remove plugin code. Those operations require a separate signed-artifact/deployment system and scoped authorization.

## Development
- Node.js 20.9+
- `npm test`
- `npm run check`

## Current limitations
- In-memory only; PostgreSQL persistence is a later step.
- Dependency version-range resolution is not implemented yet.
- Signature verification, artifact scanning and deployment orchestration are not implemented.
