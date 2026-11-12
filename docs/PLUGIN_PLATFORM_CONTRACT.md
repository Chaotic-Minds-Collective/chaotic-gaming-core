# Plugin Platform Contract

The plugin registry validates manifests and tracks metadata/lifecycle state. It does not download, dynamically load, or execute plugin code.

## Core persistence

The Core PostgreSQL schema persists plugin metadata, immutable version manifests, dependencies, per-server installations, desired state, versioned configuration and reported health. The in-memory registry remains the lifecycle state-machine reference.

## Lifecycle

`DISCOVERED -> VALIDATED -> ENABLED -> HEALTHY`

Allowed side paths include `DEGRADED`, `DISABLED`, and `REMOVED` as defined in `plugins/registry/src/registry.js`. An adapter reports actual runtime state; the Core stores desired state separately. An API request to enable a plugin does not install or execute code.

## Security

- Plugin registration and release management require a platform-scoped `plugin_manager` service role.
- Server-side lifecycle/health reports require a server-scoped `plugin_runtime` role.
- Server administrators can read and set desired state only within their server scope.
- Plugin code receives no database credentials.
- Artifact signatures, supply-chain verification, sandboxing and actual install/update workers are future milestones.
