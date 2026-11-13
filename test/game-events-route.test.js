import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { pool } from "../dist/db.js";
import { hashServiceToken } from "../dist/auth/service.js";
import { registerGameEventRoutes } from "../dist/routes/game-events.js";

test("game event route validates scope and persists authoritative metadata", {
  skip: !pool ? "DATABASE_URL is not configured" : false,
}, async (t) => {
  const app = Fastify();
  await registerGameEventRoutes(app);
  const clusterId = randomUUID();
  const serverId = randomUUID();
  const principalId = randomUUID();
  const token = "cg_srv_" + randomBytes(36).toString("base64url");
  const scope = { clusterId, serverId, gridId: "A1" };
  const baseEvent = {
    game: "atlas",
    eventType: "character.transferred",
    occurredAt: "2026-11-12T16:00:00.000Z",
    payload: { providerCharacterId: "synthetic-character" },
    scope,
    correlationId: "transfer-42",
  };
  const publish = (event, urlServerId = serverId) => app.inject({
    method: "POST",
    url: `/integrations/servers/${urlServerId}/events`,
    headers: { authorization: "Bearer " + token },
    payload: event,
  });
  try {
    await pool.query("INSERT INTO core.clusters (id, game_key, name, status) VALUES ($1, 'atlas', 'Event test cluster', 'active')", [clusterId]);
    await pool.query("INSERT INTO core.servers (id, cluster_id, game_key, name, environment, status) VALUES ($1, $2, 'atlas', 'Event test server', 'production', 'offline')", [serverId, clusterId]);
    await pool.query("INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'service', 'active')", [principalId]);
    await pool.query("INSERT INTO core.service_accounts (principal_id, application_name) VALUES ($1, $2)", [principalId, "event-test-" + principalId]);
    await pool.query("INSERT INTO core.service_credentials (principal_id, credential_hash, label) VALUES ($1, $2, 'event-test')", [principalId, hashServiceToken(token)]);
    await pool.query("INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id) SELECT $1, id, 'server', $2 FROM core.roles WHERE role_key = 'game_event_publisher'", [principalId, serverId]);

    for (const field of ["clusterId", "serverId"]) {
      await t.test(`rejects mismatched ${field} without event, outbox, or audit writes`, async () => {
        const eventId = randomUUID();
        const response = await publish({ ...baseEvent, eventId, scope: { ...scope, [field]: randomUUID() } });
        assert.equal(response.statusCode, 409, response.body);
        assert.equal(response.json().error.code, "EVENT_SCOPE_MISMATCH");
        assert.equal((await pool.query("SELECT id FROM operations.game_events WHERE server_id = $1", [serverId])).rowCount, 0);
        assert.equal((await pool.query("SELECT id FROM operations.event_outbox WHERE payload->>'eventId' = $1", [eventId])).rowCount, 0);
        assert.equal((await pool.query("SELECT id FROM operations.audit_logs WHERE actor_principal_id = $1", [principalId])).rowCount, 0);
      });
    }

    const cases = [
      { name: "lowercase UUIDs", scope },
      { name: "uppercase scope UUIDs", scope: { ...scope, clusterId: clusterId.toUpperCase(), serverId: serverId.toUpperCase() } },
      { name: "uppercase URL UUID", scope, urlServerId: serverId.toUpperCase() },
      { name: "legacy envelope", scope: undefined, correlationId: undefined },
      { name: "null correlation", scope, correlationId: null },
    ];
    for (const entry of cases) {
      await t.test(`accepts ${entry.name} and persists event and outbox metadata exactly once`, async () => {
        const eventId = randomUUID();
        const correlationId = Object.hasOwn(entry, "correlationId") ? entry.correlationId : baseEvent.correlationId;
        const event = { ...baseEvent, eventId, scope: entry.scope, correlationId };
        const response = await publish(event, entry.urlServerId);
        assert.equal(response.statusCode, 202, response.body);
        assert.equal(response.json().data.duplicate, false);
        const duplicate = await publish(event, entry.urlServerId);
        assert.equal(duplicate.statusCode, 202, duplicate.body);
        assert.equal(duplicate.json().data.duplicate, true);
        const stored = await pool.query("SELECT * FROM operations.game_events WHERE server_id = $1 AND external_event_id = $2", [serverId, eventId]);
        assert.equal(stored.rowCount, 1);
        const record = stored.rows[0];
        assert.equal(record.server_id, serverId);
        assert.equal(record.cluster_id, clusterId);
        assert.equal(record.grid_id, entry.scope?.gridId ?? null);
        assert.equal(record.correlation_id, correlationId ?? null);
        assert.deepEqual(record.payload, baseEvent.payload);
        const outbox = await pool.query("SELECT * FROM operations.event_outbox WHERE aggregate_type = 'game_event' AND aggregate_id = $1", [record.id]);
        assert.equal(outbox.rowCount, 1);
        assert.equal(outbox.rows[0].event_type, "game.event.received");
        assert.deepEqual(outbox.rows[0].payload, {
          eventRecordId: record.id, serverId, clusterId,
          gridId: entry.scope?.gridId ?? null, correlationId: correlationId ?? null,
          game: event.game, eventId, eventType: event.eventType,
          occurredAt: event.occurredAt, payload: event.payload,
        });
      });
    }

    await pool.query("UPDATE core.principal_role_assignments SET scope_id = $2 WHERE principal_id = $1 AND scope_type = 'server'", [principalId, serverId.toUpperCase()]);
    for (const urlServerId of [serverId, serverId.toUpperCase()]) {
      const response = await publish({ ...baseEvent, eventId: randomUUID() }, urlServerId);
      assert.equal(response.statusCode, 202, response.body);
    }
    const forbidden = await publish({ ...baseEvent, eventId: randomUUID() }, randomUUID());
    assert.equal(forbidden.statusCode, 403, forbidden.body);
  } finally {
    try {
      await pool.query("DELETE FROM operations.event_outbox WHERE aggregate_type = 'game_event' AND aggregate_id IN (SELECT id::text FROM operations.game_events WHERE server_id = $1)", [serverId]);
      await pool.query("DELETE FROM operations.game_events WHERE server_id = $1", [serverId]);
      await pool.query("DELETE FROM operations.audit_logs WHERE actor_principal_id = $1", [principalId]);
      await pool.query("DELETE FROM core.service_credentials WHERE principal_id = $1", [principalId]);
      await pool.query("DELETE FROM core.principal_role_assignments WHERE principal_id = $1", [principalId]);
      await pool.query("DELETE FROM core.service_accounts WHERE principal_id = $1", [principalId]);
      await pool.query("DELETE FROM core.principals WHERE id = $1", [principalId]);
      await pool.query("DELETE FROM core.servers WHERE id = $1", [serverId]);
      await pool.query("DELETE FROM core.clusters WHERE id = $1", [clusterId]);
    } finally {
      await app.close();
      await pool.end();
    }
  }
});
