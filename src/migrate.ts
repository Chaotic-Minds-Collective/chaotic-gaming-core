import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db.js";

if (!pool) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("CREATE SCHEMA IF NOT EXISTS operations");
  await client.query(`
    CREATE TABLE IF NOT EXISTS operations.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("COMMIT");

  const directory = join(process.cwd(), "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  for (const filename of files) {
    const exists = await client.query(
      "SELECT 1 FROM operations.schema_migrations WHERE filename = $1",
      [filename]
    );
    if (exists.rowCount) continue;

    const sql = await readFile(join(directory, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO operations.schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.info(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
