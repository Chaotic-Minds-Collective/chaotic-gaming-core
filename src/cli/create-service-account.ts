import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { createServiceToken, hashServiceToken } from "../security/tokens.js";

const applicationName = process.argv[2]?.trim();
if (!applicationName || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(applicationName)) {
  console.error("Usage: npm run service:create -- <application-name>");
  process.exit(2);
}
const token = createServiceToken();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const principal = await client.query(
    "INSERT INTO core.principals(principal_type,status) VALUES('service','active') RETURNING id",
  );
  const principalId = principal.rows[0].id as string;
  await client.query(
    "INSERT INTO core.service_accounts(principal_id,application_name,credential_hash) VALUES($1,$2,$3)",
    [principalId, applicationName, hashServiceToken(token)],
  );
  await client.query("COMMIT");
  console.log("Service account created. Copy this token now; it will not be shown again:");
  console.log(token);
  console.log("Principal:", principalId);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Could not create service account:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
