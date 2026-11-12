import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { hashServiceToken } from "../auth/service.js";

const applicationName = process.argv[2]?.trim();
if (!applicationName || applicationName.length < 3 || applicationName.length > 80) {
  throw new Error("Usage: npm run service:create -- <application-name>");
}
if (!pool) throw new Error("DATABASE_URL is required.");

const token = `cg_srv_${randomBytes(36).toString("base64url")}`;
const client = await pool.connect();
try {
  await client.query("BEGIN");
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
  await client.query(
    "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome) VALUES ($1, 'service.create', 'service_account', $1, 'success')",
    [principalId]
  );
  await client.query("COMMIT");
  console.info("Service account created. Copy this credential now; it cannot be retrieved later:");
  console.info(token);
  console.info("No permissions were granted. Assign only the required scoped roles.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
