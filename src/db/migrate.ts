import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./pool.js";

const migrationsDir = join(process.cwd(), "migrations");
const client = await pool.connect();

try {
  await client.query("CREATE SCHEMA IF NOT EXISTS operations");
  await client.query(`
    CREATE TABLE IF NOT EXISTS operations.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const filename of files) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM operations.schema_migrations WHERE filename = $1",
      [filename]
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(join(migrationsDir, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO operations.schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.info(`Applied migration: ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
