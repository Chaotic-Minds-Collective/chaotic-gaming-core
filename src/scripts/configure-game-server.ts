import { z } from "zod";
import { pool } from "../db.js";

const [serverId, rawConfig] = process.argv.slice(2);
if (!serverId || !rawConfig) {
  throw new Error("Usage: npm run server:configure -- <server-uuid> '<JSON configuration>'");
}
const configSchema = z.object({
  publicHostname: z.string().min(1).max(255).nullable().optional(),
  gamePort: z.number().int().min(1).max(65535).nullable().optional(),
  queryPort: z.number().int().min(1).max(65535).nullable().optional(),
  maxPlayers: z.number().int().min(1).max(10000).nullable().optional(),
  mapName: z.string().max(120).nullable().optional(),
  isListed: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one server setting is required.");

let parsedJson: unknown;
try {
  parsedJson = JSON.parse(rawConfig);
} catch {
  throw new Error("Server configuration must be valid JSON.");
}
const parsed = configSchema.safeParse(parsedJson);
if (!parsed.success) {
  throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
}
if (!pool) throw new Error("DATABASE_URL is required.");

const columns: Record<string, string> = {
  publicHostname: "public_hostname",
  gamePort: "game_port",
  queryPort: "query_port",
  maxPlayers: "max_players",
  mapName: "map_name",
  isListed: "is_listed"
};
const values: unknown[] = [serverId];
const assignments: string[] = [];
for (const [key, column] of Object.entries(columns)) {
  if (Object.hasOwn(parsed.data, key)) {
    values.push(parsed.data[key as keyof typeof parsed.data]);
    assignments.push(`${column} = $${values.length}`);
  }
}
assignments.push("updated_at = NOW()");

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const updated = await client.query(
    `UPDATE core.servers
        SET ${assignments.join(", ")}
      WHERE id = $1 AND status <> 'deleted'
      RETURNING id, name, game_key AS "gameKey", public_hostname AS "publicHostname",
                game_port AS "gamePort", query_port AS "queryPort",
                max_players AS "maxPlayers", map_name AS "mapName", is_listed AS "isListed"`,
    values
  );
  if (!updated.rows[0]) throw new Error("Active server not found.");
  await client.query(
    `INSERT INTO operations.audit_logs (action, resource_type, resource_id, outcome, metadata)
     VALUES ('server.configure', 'server', $1, 'success', $2::jsonb)`,
    [serverId, JSON.stringify({ changedFields: Object.keys(parsed.data) })]
  );
  await client.query("COMMIT");
  console.info("Server configuration saved:");
  console.info(JSON.stringify(updated.rows[0], null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
