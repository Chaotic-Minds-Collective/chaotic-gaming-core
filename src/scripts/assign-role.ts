import { pool } from "../db.js";

const [principalId, roleKey, scopeType, scopeIdArg] = process.argv.slice(2);
const allowedScopes = ["platform", "game", "cluster", "server", "guild"];

if (!principalId || !roleKey || !scopeType || !allowedScopes.includes(scopeType)) {
  throw new Error("Usage: npm run role:assign -- <principal-uuid> <role-key> <platform|game|cluster|server|guild> [scope-id]");
}
if (scopeType === "platform" && scopeIdArg) {
  throw new Error("Platform scope does not take a scope ID.");
}
if (scopeType !== "platform" && !scopeIdArg) {
  throw new Error("A scope ID is required for game, cluster, server and guild roles.");
}
if (!pool) throw new Error("DATABASE_URL is required.");

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const principal = await client.query<{ id: string }>(
    "SELECT id FROM core.principals WHERE id = $1 AND status = 'active'",
    [principalId]
  );
  if (!principal.rows[0]) throw new Error("Active principal not found.");

  const role = await client.query<{ id: string }>(
    "SELECT id FROM core.roles WHERE role_key = $1",
    [roleKey]
  );
  if (!role.rows[0]) throw new Error(`Unknown role: ${roleKey}`);

  if (scopeType === "game") {
    const exists = await client.query("SELECT 1 FROM core.games WHERE game_key = $1", [scopeIdArg]);
    if (!exists.rowCount) throw new Error("Game scope not found.");
  } else if (scopeType === "cluster") {
    const exists = await client.query("SELECT 1 FROM core.clusters WHERE id = $1", [scopeIdArg]);
    if (!exists.rowCount) throw new Error("Cluster scope not found.");
  } else if (scopeType === "server") {
    const exists = await client.query("SELECT 1 FROM core.servers WHERE id = $1", [scopeIdArg]);
    if (!exists.rowCount) throw new Error("Server scope not found.");
  }

  const assignment = await client.query(
    `INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [principalId, role.rows[0].id, scopeType, scopeIdArg ?? null]
  );

  await client.query(
    `INSERT INTO operations.audit_logs
      (action, resource_type, resource_id, outcome, metadata)
     VALUES ('role.assign', 'principal', $1, 'success', $2::jsonb)`,
    [principalId, JSON.stringify({ roleKey, scopeType, scopeId: scopeIdArg ?? null })]
  );
  await client.query("COMMIT");
  console.info(assignment.rows[0] ? "Role assignment created." : "That role assignment already exists.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
