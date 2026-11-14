import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { pool } from "../dist/db.js";
import { hashServiceToken } from "../dist/auth/service.js";
import { registerEventOutboxRoutes } from "../dist/routes/event-outbox.js";

test("game event outbox claims are server-scoped and acknowledgements require the active per-event lease", {
  skip: !pool ? "DATABASE_URL is not configured" : false
}, async (t) => {
  const app = Fastify();
  await registerEventOutboxRoutes(app);
  const clusterId = randomUUID();
  const serverId = randomUUID();
  const otherServerId = randomUUID();
  const principalId = randomUUID();
  const token = "cg_srv_" + randomBytes(36).toString("base64url");
  const eventId = randomUUID();
  const otherEventId = randomUUID();

  try {
    await pool.query("INSERT INTO core.clusters (id, game_key, name, status) VALUES ($1, 'atlas', 'Outbox test cluster', 'active')", [clusterId]);
    for (const id of [serverId, otherServerId]) {
      await pool.query("INSERT INTO core.servers (id, cluster_id, game_key, name, environment, status) VALUES ($1, $2, 'atlas', 'Outbox test server', 'production', 'offline')", [id, clusterId]);
    }
    await pool.query("INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'service', 'active')", [principalId]);
    await pool.query("INSERT INTO core.service_accounts (principal_id, application_name) VALUES ($1, $2)", [principalId, "outbox-test-" + principalId]);
    await pool.query("INSERT INTO core.service_credentials (principal_id, credential_hash, label) VALUES ($1, $2, 'test')", [principalId, hashServiceToken(token)]);
    await pool.query(
      "INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id) SELECT $1, id, 'server', $2 FROM core.roles WHERE role_key = 'game_event_consumer'",
      [principalId, serverId]
    );
    await pool.query(
      "INSERT INTO operations.event_outbox (id, event_type, aggregate_type, aggregate_id, payload) VALUES ($1, 'game.event.received', 'game_event', $2, $3::jsonb), ($4, 'game.event.received', 'game_event', $5, $6::jsonb)",
      [eventId, randomUUID(), JSON.stringify({ serverId, eventType: "chat.global" }), otherEventId, randomUUID(), JSON.stringify({ serverId: otherServerId, eventType: "chat.global" })]
    );

    const claim = () => app.inject({
      method: "POST",
      url: `/integrations/servers/${serverId}/events/claim`,
      headers: { authorization: "Bearer " + token },
      payload: { limit: 10 }
    });
    const claimed = await claim();
    assert.equal(claimed.statusCode, 200);
    const rows = claimed.json().data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, eventId);
    assert.ok(rows[0].leaseToken);

    const wrongLease = await app.inject({
      method: "POST",
      url: `/integrations/servers/${serverId}/events/${eventId}/ack`,
      headers: { authorization: "Bearer " + token },
      payload: { leaseToken: randomUUID(), outcome: "delivered" }
    });
    assert.equal(wrongLease.statusCode, 409);

    const ack = () => app.inject({
      method: "POST",
      url: `/integrations/servers/${serverId}/events/${eventId}/ack`,
      headers: { authorization: "Bearer " + token },
      payload: { leaseToken: rows[0].leaseToken, outcome: "delivered" }
    });
    const accepted = await ack();
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().data.duplicate, false);
    const duplicate = await ack();
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().data.duplicate, true);
    assert.equal((await pool.query("SELECT processed_at FROM operations.event_outbox WHERE id = $1", [eventId])).rows[0].processed_at === null, false);
  } finally {
    await pool.query("DELETE FROM operations.event_outbox WHERE id = ANY($1::uuid[])", [[eventId, otherEventId]]);
    await pool.query("DELETE FROM operations.audit_logs WHERE actor_principal_id = $1", [principalId]);
    await pool.query("DELETE FROM core.service_credentials WHERE principal_id = $1", [principalId]);
    await pool.query("DELETE FROM core.principal_role_assignments WHERE principal_id = $1", [principalId]);
    await pool.query("DELETE FROM core.service_accounts WHERE principal_id = $1", [principalId]);
    await pool.query("DELETE FROM core.principals WHERE id = $1", [principalId]);
    await pool.query("DELETE FROM core.servers WHERE id = ANY($1::uuid[])", [[serverId, otherServerId]]);
    await pool.query("DELETE FROM core.clusters WHERE id = $1", [clusterId]);
    await app.close();
  }
});
