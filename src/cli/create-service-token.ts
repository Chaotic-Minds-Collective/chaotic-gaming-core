import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";

const applicationName = process.argv[2]?.trim();
const scopes = (process.argv[3] ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);

if (!applicationName || scopes.length === 0) {
  console.error("Usage: npm run service-token:create -- <application-name> <scope,scope>");
  process.exit(1);
}
if (applicationName.length > 100 || scopes.some((scope) => scope.length > 120)) {
  console.error("Application name or scope is too long.");
  process.exit(1);
}

const principalId = randomUUID();
const credentialId = randomUUID();
const secret = `cg_srv_${randomBytes(32).toString("base64url")}`;
const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'service', 'active')",
    [principalId]
  );
  await client.query(
    "INSERT INTO core.service_accounts (principal_id, application_name, credential_rotated_at) VALUES ($1, $2, now())",
    [principalId, applicationName]
  );
  await client.query(
    "INSERT INTO core.service_credentials (id, principal_id, secret_hash, scopes) VALUES ($1, $2, $3, $4)",
    [credentialId, principalId, secretHash, scopes]
  );
  await client.query("COMMIT");
  console.log("Service credential created. Copy it now; it cannot be retrieved later.");
  console.log(secret);
  console.log(`Principal: ${principalId}`);
  console.log(`Scopes: ${scopes.join(", ")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
