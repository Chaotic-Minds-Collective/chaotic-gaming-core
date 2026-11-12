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
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
