import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./pool.js";

const migrationsDirectory = join(process.cwd(), "migrations");

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(724193810)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS core_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const existing = await client.query(
        "SELECT 1 FROM core_schema_migrations WHERE version = $1",
        [file],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO core_schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.info(`Applied migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(724193810)").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error("Database migration failed", error);
  process.exitCode = 1;
});
