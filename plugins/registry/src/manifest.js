const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+){2,}$/;
const GAMES = new Set(["platform", "atlas", "7dtd", "ark"]);
const REQUIRED = ["id", "name", "version", "game", "apiVersion", "dependencies", "capabilities", "permissions", "compatibility"];

function isNumericIdentifier(value) {
  return /^\d+$/.test(value);
}

function isValidCoreNumeric(value) {
  return value === "0" || (/^[1-9]\d*$/.test(value));
}

function isValidSemVer(version) {
  const plusIndex = version.indexOf("+");
  if (plusIndex !== -1 && version.indexOf("+", plusIndex + 1) !== -1) return false;

  const mainAndPre = plusIndex === -1 ? version : version.slice(0, plusIndex);
  const build = plusIndex === -1 ? "" : version.slice(plusIndex + 1);

  if (plusIndex !== -1) {
    if (!build) return false;
    const buildIds = build.split(".");
    if (buildIds.some((id) => !id || !/^[0-9A-Za-z-]+$/.test(id))) return false;
  }

  const hyphenIndex = mainAndPre.indexOf("-");
  if (hyphenIndex !== -1 && mainAndPre.indexOf("-", hyphenIndex + 1) !== -1) return false;

  const core = hyphenIndex === -1 ? mainAndPre : mainAndPre.slice(0, hyphenIndex);
  const prerelease = hyphenIndex === -1 ? "" : mainAndPre.slice(hyphenIndex + 1);

  const coreParts = core.split(".");
  if (coreParts.length !== 3) return false;
  if (!coreParts.every((part) => isValidCoreNumeric(part))) return false;

  if (hyphenIndex !== -1) {
    if (!prerelease) return false;
    const preIds = prerelease.split(".");
    for (const id of preIds) {
      if (!id || !/^[0-9A-Za-z-]+$/.test(id)) return false;
      if (isNumericIdentifier(id) && !isValidCoreNumeric(id)) return false;
    }
  }

  return true;
}

export class PluginManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginManifestError";
  }
}

export function validatePluginManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PluginManifestError("Manifest must be an object");
  }

  for (const key of REQUIRED) {
    if (!(key in input)) throw new PluginManifestError(`Missing required field: ${key}`);
  }

  if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) {
    throw new PluginManifestError("id must be a stable reverse-domain identifier");
  }
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) {
    throw new PluginManifestError("name must be a non-empty string of at most 120 characters");
  }
  if (typeof input.version !== "string" || input.version.length > 256 || !isValidSemVer(input.version)) {
    throw new PluginManifestError("version must use semantic versioning and be at most 256 characters");
  }
  if (!GAMES.has(input.game)) {
    throw new PluginManifestError("game must be platform, atlas, 7dtd, or ark");
  }
  if (typeof input.apiVersion !== "string" || !/^\d+$/.test(input.apiVersion)) {
    throw new PluginManifestError("apiVersion must be a numeric major version string");
  }

  for (const field of ["dependencies", "capabilities", "permissions"]) {
    if (!Array.isArray(input[field]) || input[field].some((value) => typeof value !== "string" || !value.trim())) {
      throw new PluginManifestError(`${field} must be an array of non-empty strings`);
    }
    if (new Set(input[field]).size !== input[field].length) {
      throw new PluginManifestError(`${field} must not contain duplicates`);
    }
  }

  if (input.dependencies.includes(input.id)) {
    throw new PluginManifestError("A plugin cannot depend on itself");
  }
  if (!input.compatibility || typeof input.compatibility !== "object" || Array.isArray(input.compatibility)) {
    throw new PluginManifestError("compatibility must be an object");
  }

  for (const field of ["gameBuilds", "serverApi", "operatingSystems"]) {
    if (!Array.isArray(input.compatibility[field]) ||
        input.compatibility[field].some((value) => typeof value !== "string")) {
      throw new PluginManifestError(`compatibility.${field} must be an array of strings`);
    }
  }

  if (input.configSchema !== undefined &&
      (!input.configSchema || typeof input.configSchema !== "object" || Array.isArray(input.configSchema))) {
    throw new PluginManifestError("configSchema must be an object when supplied");
  }

  // Return a defensive JSON copy so callers cannot mutate the registered manifest.
  return JSON.parse(JSON.stringify(input));
}
