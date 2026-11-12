import { pool } from "../db.js";

const principalId = process.argv[2];
if (!principalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principalId)) {
  throw new Error("Usage: npm run admin:grant -- <PLAYER_PRINCIPAL_UUID>");
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

  const role = await client.query("SELECT id FROM core.roles WHERE role_key = 'platform_admin'");
  if (!role.rows[0]) throw new Error("platform_admin role is not seeded.");

  const existing = await client.query(
    "SELECT 1 FROM core.principal_role_assignments WHERE principal_id = $1 AND role_id = $2 AND scope_type = 'platform' AND scope_id IS NULL AND (expires_at IS NULL OR expires_at > NOW())",
    [principalId, role.rows[0].id]
  );
  if (!existing.rowCount) {
    await client.query(
      "INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'platform', NULL)",
      [principalId, role.rows[0].id]
    );
    await client.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'platform.admin.granted', 'principal', $1, 'success', '{}'::jsonb)",
      [principalId]
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
