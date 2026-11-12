import { pool } from "../db.js";

const [gameKey, clusterName, serverName, environment = "development"] = process.argv.slice(2);
const validGames = ["atlas", "7dtd", "ark"];
const validEnvironments = ["development", "test", "staging", "production"];

if (!gameKey || !validGames.includes(gameKey)) {
  throw new Error("Usage: npm run server:create -- <atlas|7dtd|ark> <cluster-name> <server-name> [development|test|staging|production]");
}
if (!clusterName?.trim() || !serverName?.trim()) {
  throw new Error("Cluster name and server name are required.");
}
if (!validEnvironments.includes(environment)) {
  throw new Error("Invalid environment.");
}
if (!pool) throw new Error("DATABASE_URL is required.");

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const game = await client.query("SELECT game_key FROM core.games WHERE game_key = $1", [gameKey]);
  if (!game.rowCount) throw new Error(`Game is not registered in Core: ${gameKey}`);

  const cluster = await client.query<{ id: string }>(
    `INSERT INTO core.clusters (game_key, name, status)
     VALUES ($1, $2, 'active')
     ON CONFLICT (game_key, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [gameKey, clusterName.trim()]
  );
  const clusterId = cluster.rows[0]?.id;
  if (!clusterId) throw new Error("Cluster registration failed.");

  const server = await client.query<{ id: string }>(
    `INSERT INTO core.servers (cluster_id, game_key, name, environment, status)
     VALUES ($1, $2, $3, $4, 'offline')
     RETURNING id`,
    [clusterId, gameKey, serverName.trim(), environment]
  );
  const serverId = server.rows[0]?.id;
  if (!serverId) throw new Error("Server registration failed.");

  await client.query(
    `INSERT INTO operations.audit_logs
      (action, resource_type, resource_id, outcome, metadata)
     VALUES ('server.register', 'server', $1, 'success', $2::jsonb)`,
    [serverId, JSON.stringify({ gameKey, clusterId, environment })]
  );
  await client.query("COMMIT");
  console.info("Server registered. Save this UUID for the adapter configuration:");
  console.info(serverId);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
