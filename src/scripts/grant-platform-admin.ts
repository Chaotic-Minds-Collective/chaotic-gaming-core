import { pool } from "../db.js";

const principalId = process.argv[2];
const actorPrincipalId = process.env.PLATFORM_ADMIN_ACTOR_PRINCIPAL_ID;
const principalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!principalId || !principalIdPattern.test(principalId)) {
  throw new Error("Usage: PLATFORM_ADMIN_ACTOR_PRINCIPAL_ID=<OPERATOR_OR_SERVICE_PRINCIPAL_UUID> npm run admin:grant -- <PLAYER_PRINCIPAL_UUID>");
}
if (!actorPrincipalId || !principalIdPattern.test(actorPrincipalId)) {
  throw new Error("PLATFORM_ADMIN_ACTOR_PRINCIPAL_ID must identify the trusted operator or service principal performing the grant.");
}
if (!pool) throw new Error("DATABASE_URL is required.");

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const principal = await client.query(
    "SELECT id FROM core.principals WHERE id = $1 AND principal_type = 'user'",
    [principalId]
  );
  if (!principal.rowCount) throw new Error("Player principal not found.");
  const actor = await client.query("SELECT id FROM core.principals WHERE id = $1", [actorPrincipalId]);
  if (!actor.rowCount) throw new Error("The configured platform-admin actor principal was not found.");

  const role = await client.query<{ id: string }>("SELECT id FROM core.roles WHERE role_key = 'platform_admin'");
  const roleId = role.rows[0]?.id;
  if (!roleId) throw new Error("platform_admin role is not seeded.");

  const existing = await client.query(
    "SELECT 1 FROM core.principal_role_assignments WHERE principal_id = $1 AND role_id = $2 AND scope_type = 'platform' AND scope_id IS NULL AND (expires_at IS NULL OR expires_at > NOW())",
    [principalId, roleId]
  );
  if (!existing.rowCount) {
    await client.query(
      "INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'platform', NULL)",
      [principalId, roleId]
    );
    await client.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'platform.admin.granted', 'principal', $2, 'success', '{}'::jsonb)",
      [actorPrincipalId, principalId]
    );
  }
  await client.query("COMMIT");
  process.stdout.write(existing.rowCount ? "Player already has platform_admin.\n" : "platform_admin granted.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
