import test from "node:test";
import assert from "node:assert/strict";
import { validatePluginManifest, PluginManifestError } from "../src/plugins/manifest.js";
import { PluginRegistry, PluginRegistryError } from "../src/plugins/registry.js";

const manifest = (overrides = {}) => ({
  id: "com.chaoticgaming.platform.server-health",
  name: "Server Status & Health",
  version: "0.1.0",
  game: "platform",
  apiVersion: "1",
  dependencies: [],
  capabilities: ["server.health.read"],
  permissions: ["server.status.read"],
  compatibility: { gameBuilds: [], serverApi: [], operatingSystems: [] },
  configSchema: {},
  ...overrides
});

test("validates and defensively copies a plugin manifest", () => {
  const input = manifest();
  const result = validatePluginManifest(input);
  assert.deepEqual(result, input);
  result.capabilities.push("mutated");
  assert.equal(input.capabilities.length, 1);
});

test("rejects missing fields, invalid IDs, versions and duplicate capabilities", () => {
  assert.throws(() => validatePluginManifest({}), PluginManifestError);
  assert.throws(() => validatePluginManifest(manifest({ id: "bad" })), /reverse-domain/);
  assert.throws(() => validatePluginManifest(manifest({ version: "1.0" })), /semantic versioning/);
  assert.throws(() => validatePluginManifest(manifest({ capabilities: ["x", "x"] })), /duplicates/);
});

test("registers plugins and validates lifecycle transitions", () => {
  const registry = new PluginRegistry();
  registry.register(manifest());
  assert.equal(registry.get(manifest().id).status, "DISCOVERED");
  registry.transition(manifest().id, "VALIDATED");
  registry.transition(manifest().id, "ENABLED");
  registry.transition(manifest().id, "HEALTHY", { healthMessage: "ready" });
  assert.equal(registry.get(manifest().id).healthMessage, "ready");
  assert.throws(() => registry.transition(manifest().id, "REMOVED"), /Invalid lifecycle transition/);
});

test("prevents enabling plugins before dependencies are enabled", () => {
  const registry = new PluginRegistry();
  registry.register(manifest({ id: "com.chaoticgaming.platform.shared-core" }));
  registry.register(manifest({
    id: "com.chaoticgaming.platform.chat-bridge",
    dependencies: ["com.chaoticgaming.platform.shared-core"]
  }));
  registry.transition("com.chaoticgaming.platform.shared-core", "VALIDATED");
  registry.transition("com.chaoticgaming.platform.chat-bridge", "VALIDATED");
  assert.throws(
    () => registry.transition("com.chaoticgaming.platform.chat-bridge", "ENABLED"),
    /Dependency is not enabled/
  );
});

test("prevents duplicate registration and unknown plugins", () => {
  const registry = new PluginRegistry();
  registry.register(manifest());
  assert.throws(() => registry.register(manifest()), /already registered/);
  assert.throws(() => registry.transition("missing.plugin.id", "VALIDATED"), PluginRegistryError);
});

test("filters plugin inventory by game and status", () => {
  const registry = new PluginRegistry();
  registry.register(manifest());
  registry.register(manifest({ id: "com.chaoticgaming.atlas.audit", game: "atlas" }));
  assert.equal(registry.list({ game: "atlas" }).length, 1);
  assert.equal(registry.list({ status: "DISCOVERED" }).length, 2);
});
