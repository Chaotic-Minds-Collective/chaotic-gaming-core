import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = config.DATABASE_URL
  ? new Pool({
      connectionString: config.DATABASE_URL,
      ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    })
  : null;

export async function checkDatabase(): Promise<boolean> {
  if (!pool) return false;
  let client: pg.PoolClient | undefined;
  let failed = false;
  const onClientError = () => {
    failed = true;
  };
  try {
    client = await pool.connect();
    client.on("error", onClientError);
    // pg supports a per-query deadline, though @types/pg omits this option
    // from QueryConfig. Keep the inferred option type rather than casting it.
    const readinessQuery = { text: "SELECT 1", query_timeout: 5_000 };
    await client.query(readinessQuery);
    return !failed;
  } catch {
    failed = true;
    return false;
  } finally {
    client?.removeListener("error", onClientError);
    // A client-side timeout does not cancel the server query. Destroy the
    // connection on failure so probes cannot retain clients or block shutdown.
    client?.release(failed);
  }
}
