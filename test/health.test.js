import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import Fastify from "fastify";

test("readiness handles dropped and stalled database connections and permits pool shutdown", { timeout: 15_000 }, async () => {
  let stall = false;
  let drop = false;
  let queries = 0;
  const sockets = new Set();
  // Minimal PostgreSQL protocol peer: accept startup, then stop replying to
  // queries when requested. No external database or provider is contacted.
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let startup = true;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= (startup ? 4 : 5)) {
        const length = startup ? buffer.readInt32BE(0) : buffer.readInt32BE(1) + 1;
        if (buffer.length < length) return;
        const type = buffer[0];
        buffer = buffer.subarray(length);
        if (startup) {
          startup = false;
          socket.write(Buffer.from("5200000008000000005a0000000549", "hex"));
        } else if (type === 81) { // Query
          queries++;
          if (drop) socket.destroy();
          else if (!stall) socket.write(Buffer.from("430000000d53454c4543542031005a0000000549", "hex"));
        } else if (type === 88) { // Terminate
          socket.end();
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DATABASE_URL = `postgresql://synthetic@127.0.0.1:${server.address().port}/synthetic?sslmode=disable`;
  const { pool, checkDatabase } = await import("../dist/db.js");
  const { registerHealthRoutes } = await import("../dist/routes/health.js");
  const app = Fastify();
  try {
    await registerHealthRoutes(app);
    const healthy = await app.inject("/health/ready");
    assert.equal(healthy.statusCode, 200);
    assert.deepEqual(healthy.json(), { status: "ready", checks: { database: "ok" } });
    drop = true;
    assert.equal(await checkDatabase(), false, "a dropped connection fails without an uncaught error");
    assert.equal(pool.totalCount, 0, "the dropped client was removed from the pool");
    const dropped = await app.inject("/health/ready");
    assert.equal(dropped.statusCode, 503);
    assert.deepEqual(dropped.json(), { status: "not_ready", checks: { database: "unavailable" } });
    drop = false;
    stall = true;
    const started = Date.now();
    const unavailable = await app.inject("/health/ready");
    assert.equal(queries, 4, "the timed-out query reached an established connection");
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), { status: "not_ready", checks: { database: "unavailable" } });
    assert.ok(Date.now() - started < 10_000, "readiness has a bounded query deadline");
    assert.equal(pool.totalCount, 0, "the stalled client was removed from the pool");
    await pool.end();
  } finally {
    await app.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (!pool.ending) await pool.end();
  }
});
