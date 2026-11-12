export type PluginGame = "platform" | "atlas" | "7dtd" | "ark";

export interface PluginCompatibility {
  gameBuilds: string[];
  serverApi: string[];
  operatingSystems: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  game: PluginGame;
  apiVersion: string;
  dependencies: string[];
  capabilities: string[];
  permissions: string[];
  compatibility: PluginCompatibility;
  configSchema?: Record<string, unknown>;
}

export declare class PluginManifestError extends Error {
  constructor(message: string);
}

export declare function validatePluginManifest(input: unknown): PluginManifest;
