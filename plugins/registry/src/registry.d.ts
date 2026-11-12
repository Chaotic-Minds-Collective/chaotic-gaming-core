import type { PluginManifest } from "./manifest.js";

export type PluginLifecycleStatus =
  | "DISCOVERED"
  | "VALIDATED"
  | "ENABLED"
  | "HEALTHY"
  | "DEGRADED"
  | "DISABLED"
  | "REMOVED";

export interface PluginRecord {
  manifest: PluginManifest;
  status: PluginLifecycleStatus;
  registeredAt: string;
  updatedAt: string;
  lastHealthAt: string | null;
  healthMessage: string | null;
}

export declare function canTransitionPluginState(
  currentStatus: string,
  nextStatus: string
): boolean;

export declare class PluginRegistryError extends Error {
  constructor(message: string);
}

export declare class PluginRegistry {
  constructor(options?: { clock?: () => Date });
  register(manifest: unknown): PluginRecord;
  get(pluginId: string): PluginRecord | null;
  list(filters?: { game?: string; status?: PluginLifecycleStatus }): PluginRecord[];
  transition(
    pluginId: string,
    nextStatus: PluginLifecycleStatus,
    options?: { healthMessage?: string | null }
  ): PluginRecord;
}
