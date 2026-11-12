# Plugin Registry API

## Public catalogue

`GET /plugins`

Returns validated plugin metadata and latest versions. It does not return secrets or executable artifact contents.

## Register a plugin release

`POST /plugins`

Requires a platform-scoped service identity with `plugins.manage` (normally the `plugin_manager` role). Body:

```json
{
  "manifest": {
    "id": "com.example.server-status",
    "name": "Server Status",
    "version": "1.0.0",
    "game": "7dtd",
    "apiVersion": "1",
    "dependencies": [],
    "capabilities": ["server.status"],
    "permissions": ["servers.read"],
    "compatibility": {
      "gameBuilds": ["exact-tested-build"],
      "serverApi": ["exact-tested-api"],
      "operatingSystems": ["windows"]
    }
  },
  "artifactDigest": "sha256:<64-hex-digest>",
  "artifactUrl": "https://artifacts.example.test/plugin.zip"
}
```

The existing manifest validator is authoritative. Dependencies must already be registered. Artifact URLs must use HTTPS. This endpoint registers metadata; it does not download or execute code.

## Per-server desired state

`GET /servers/{serverId}/plugins` — requires `plugins.read` at the exact server scope.

`POST /servers/{serverId}/plugins/{pluginId}/state` — requires `plugins.manage` at the exact server scope.

```json
{ "desiredState": "enabled" }
```

This records desired state only. It does not install, enable or execute code on the server.

## Runtime health report

`POST /integrations/servers/{serverId}/plugins/{pluginId}/health`

Requires `plugins.report` at the exact server scope. The runtime reports one valid lifecycle transition at a time using the existing in-memory registry state machine as the reference. Enabling requires desired state to be enabled.

## Not implemented

Artifact signature verification, sandboxing, binary installation, automatic updates, rollback, and plugin execution are not implemented. Never use this API as proof that a plugin binary is trusted or installed.
