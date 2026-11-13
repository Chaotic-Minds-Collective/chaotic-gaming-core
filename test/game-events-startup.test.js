import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("event schema gate prevents listening before migration 020", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import Fastify from "fastify";
    const { pool } = await import("./dist/db.js");
    const { registerGameEventRoutes } = await import("./dist/routes/game-events.js");
    let migrated = false;
    let probes = 0;
    pool.query = async (query) => {
      assert.match(query.text, /SELECT cluster_id, grid_id, correlation_id/);
      assert.equal(query.query_timeout, 5000);
      probes++;
      if (!migrated) throw Object.assign(new Error("column cluster_id does not exist"), { code: "42703" });
      return { rows: [] };
    };
    const premature = Fastify();
    await registerGameEventRoutes(premature);
    await assert.rejects(premature.listen({ port: 0, host: "127.0.0.1" }), { code: "42703" });
    assert.equal(premature.server.listening, false);
    await premature.close();
    migrated = true;
    const ready = Fastify();
    await registerGameEventRoutes(ready);
    await ready.listen({ port: 0, host: "127.0.0.1" });
    assert.equal(ready.server.listening, true);
    assert.equal(probes, 2);
    await ready.close();
    await pool.end();
  `], {
    env: { ...process.env, DATABASE_URL: "postgresql://synthetic@127.0.0.1/synthetic", NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
});
