import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { hashServiceToken } from "../auth/service.js";

const args = process.argv.slice(2);
const applicationName = args[0]?.trim();
if (!applicationName || applicationName.length < 3 || applicationName.length > 80) {
  throw new Error("Usage: npm run service:create -- <application-name> [--role <role-key> --scope-type <type> [--scope-id <id>]]");
}
if (!pool) throw new Error("DATABASE_URL is required.");

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const roleKey = option("--role");
const scopeType = option("--scope-type");
const scopeId = option("--scope-id") ?? null;
const validScopes = ["platform", "game", "cluster", "server", "guild"];

if (Boolean(roleKey) !== Boolean(scopeType)) {
  throw new Error("--role and --scope-type must be supplied together.");
}
if (scopeType && !validScopes.includes(scopeType)) {
  throw new Error("--scope-type must be platform, game, cluster, server, or guild.");
}
if (scopeId && !scopeType) throw new Error("--scope-id requires --scope-type.");
if (scopeType === "platform" && scopeId) throw new Error("Platform scope must not include --scope-id.");
if (scopeType && scopeType !== "platform" && !scopeId) {
  throw new Error("--scope-id is required for non-platform scopes.");
}
if (scopeId && scopeId.length > 128) throw new Error("--scope-id must be at most 128 characters.");

const token = `cg_srv_${randomBytes(36).toString("base64url")}`;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  if (roleKey && scopeType && scopeId) {
    if (scopeType === "game") {
      const exists = await client.query("SELECT 1 FROM core.games WHERE game_key = $1", [scopeId]);
      if (!exists.rowCount) throw new Error("Game scope not found.");
    } else if (scopeType === "cluster") {
      const exists = await client.query("SELECT 1 FROM core.clusters WHERE id = $1", [scopeId]);
      if (!exists.rowCount) throw new Error("Cluster scope not found.");
    } else if (scopeType === "server") {
      const exists = await client.query("SELECT 1 FROM core.servers WHERE id = $1", [scopeId]);
      if (!exists.rowCount) throw new Error("Server scope not found.");
    }
  }

  const principal = await client.query<{ id: string }>(
    "INSERT INTO core.principals (principal_type, status) VALUES ('service', 'active') RETURNING id"
  );
  const principalId = principal.rows[0]?.id;
  if (!principalId) throw new Error("Service principal creation failed.");

  await client.query(
    "INSERT INTO core.service_accounts (principal_id, application_name) VALUES ($1, $2)",
    [principalId, applicationName]
  );
  await client.query(
    "INSERT INTO core.service_credentials (principal_id, credential_hash, label) VALUES ($1, $2, 'initial')",
    [principalId, hashServiceToken(token)]
  );

  if (roleKey && scopeType) {
    const role = await client.query<{ id: string }>(
      "SELECT id FROM core.roles WHERE role_key = $1",
      [roleKey]
    );
    if (!role.rows[0]) throw new Error(`Unknown role: ${roleKey}`);
    await client.query(
      `INSERT INTO core.principal_role_assignments
        (principal_id, role_id, scope_type, scope_id)
       VALUES ($1, $2, $3, $4)`,
      [principalId, role.rows[0].id, scopeType, scopeId]
    );
  }

  await client.query(
    "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome) VALUES ($1, 'service.create', 'service_account', $1, 'success')",
    [principalId]
  );
  await client.query("COMMIT");
  console.info("Service account created. Copy this credential now; it cannot be retrieved later:");
  console.info(token);
  console.info(roleKey ? `Granted role ${roleKey} at ${scopeType} scope ${scopeId ?? "(platform)"}. ` : "No permissions were granted.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
