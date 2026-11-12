import { validatePluginManifest } from "./manifest.js";

const TRANSITIONS = {
  DISCOVERED: new Set(["VALIDATED", "DISABLED", "REMOVED"]),
  VALIDATED: new Set(["ENABLED", "DISABLED", "REMOVED"]),
  ENABLED: new Set(["HEALTHY", "DEGRADED", "DISABLED"]),
  HEALTHY: new Set(["DEGRADED", "DISABLED"]),
  DEGRADED: new Set(["HEALTHY", "DISABLED"]),
  DISABLED: new Set(["VALIDATED", "REMOVED"]),
  REMOVED: new Set()
};

export class PluginRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginRegistryError";
  }
}

/**
 * In-memory metadata/lifecycle registry.
 * This intentionally does not load or execute plugin code.
 */
export class PluginRegistry {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.records = new Map();
  }

  register(manifestInput) {
    const manifest = validatePluginManifest(manifestInput);
    const existing = this.records.get(manifest.id);
    if (existing && existing.status !== "REMOVED") {
      throw new PluginRegistryError(`Plugin already registered: ${manifest.id}`);
    }

    const record = {
      manifest,
      status: "DISCOVERED",
      registeredAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
      lastHealthAt: null,
      healthMessage: null
    };
    this.records.set(manifest.id, record);
    return structuredClone(record);
  }

  get(pluginId) {
    const record = this.records.get(pluginId);
    return record ? structuredClone(record) : null;
  }

  list({ game, status } = {}) {
    return [...this.records.values()]
      .filter((record) => !game || record.manifest.game === game)
      .filter((record) => !status || record.status === status)
      .map((record) => structuredClone(record));
  }

  transition(pluginId, nextStatus, { healthMessage = null } = {}) {
    const record = this.records.get(pluginId);
    if (!record) throw new PluginRegistryError(`Unknown plugin: ${pluginId}`);
    if (!Object.hasOwn(TRANSITIONS, nextStatus)) {
      throw new PluginRegistryError(`Unknown lifecycle status: ${nextStatus}`);
    }
    if (!TRANSITIONS[record.status].has(nextStatus)) {
      throw new PluginRegistryError(`Invalid lifecycle transition: ${record.status} -> ${nextStatus}`);
    }

    if (nextStatus === "ENABLED") {
      for (const dependencyId of record.manifest.dependencies) {
        const dependency = this.records.get(dependencyId);
        if (!dependency || !["ENABLED", "HEALTHY"].includes(dependency.status)) {
          throw new PluginRegistryError(`Dependency is not enabled: ${dependencyId}`);
        }
      }
    }

    record.status = nextStatus;
    record.updatedAt = this.clock().toISOString();
    if (["HEALTHY", "DEGRADED"].includes(nextStatus)) {
      record.lastHealthAt = record.updatedAt;
      record.healthMessage = healthMessage;
    }
    return structuredClone(record);
  }
}
