import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("request logs omit Discord callback credentials while preserving request context", () => {
  const appUrl = new URL("../dist/app.js", import.meta.url).href;
  const env = { ...process.env, NODE_ENV: "test", LOG_LEVEL: "info" };
  // This checks logging before database access; no provider or database is needed.
  delete env.DATABASE_URL;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { buildApp } = await import(${JSON.stringify(appUrl)});
    const app = buildApp();
    for (const query of [
      "code=private-code&state=private-state",
      "%63ode=encoded-private-code&state=encoded-private-state",
      "error=access_denied&state=denied-private-state"
    ]) {
      const response = await app.inject({ url: "/auth/discord-link/callback?" + query });
      if (response.statusCode !== 503) throw new Error("Expected database unavailable");
    }
    await app.close();
  `], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-code|private-state|access_denied|%63ode/);
  const entries = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  const requests = entries.filter((entry) => entry.req);
  assert.equal(requests.length, 3);
  for (const entry of requests) {
    assert.equal(entry.req.url, "/auth/discord-link/callback");
    assert.equal(entry.req.method, "GET");
    assert.ok(entry.reqId);
    assert.ok(entry.req.remoteAddress);
  }
  assert.equal(entries.filter((entry) => entry.res?.statusCode === 503).length, 3);
});
