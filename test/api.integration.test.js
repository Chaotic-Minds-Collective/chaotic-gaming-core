import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../dist/app.js";
import { pool } from "../dist/db.js";
import { hashServiceToken } from "../dist/auth/service.js";

test("public server listing hides unlisted servers and reward workers use leased delivery", {
  skip: !pool ? "DATABASE_URL is not configured" : false,
}, async () => {
  const app = buildApp();
  await app.ready();

  const ids = {
    cluster: randomUUID(),
    publicServer: randomUUID(),
    privateServer: randomUUID(),
    userPrincipal: randomUUID(),
    servicePrincipal: randomUUID(),
    product: randomUUID(),
    entitlement: randomUUID(),
    reward: randomUUID(),
  };
  const suffix = randomUUID();
  const username = `test_${suffix.replaceAll("-", "").slice(0, 20)}`;
  const sku = `TEST-${suffix.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const applicationName = `test-reward-worker-${suffix}`;
  const token = `cg_srv_${randomBytes(36).toString("base64url")}`;

  try {
    await pool.query(
      "INSERT INTO core.clusters (id, game_key, name, status) VALUES ($1, '7dtd', $2, 'active')",
      [ids.cluster, `test-cluster-${suffix}`]
    );
    await pool.query(
      `INSERT INTO core.servers
        (id, cluster_id, game_key, name, environment, status, public_hostname, game_port, is_listed)
       VALUES
        ($1, $3, '7dtd', 'Public test server', 'production', 'offline', 'public.example.test', 26900, TRUE),
        ($2, $3, '7dtd', 'Private test server', 'production', 'offline', NULL, NULL, FALSE)`,
      [ids.publicServer, ids.privateServer, ids.cluster]
    );
    await pool.query(
      `INSERT INTO operations.server_heartbeats
        (server_id, server_version, adapter_version, online, player_count, observed_at)
       VALUES ($1, 'test-build', 'test-adapter', TRUE, 3, NOW())`,
      [ids.publicServer]
    );

    await pool.query(
      "INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'user', 'active')",
      [ids.userPrincipal]
    );
    await pool.query(
      "INSERT INTO core.users (principal_id, username) VALUES ($1, $2)",
      [ids.userPrincipal, username]
    );
    await pool.query(
      "INSERT INTO commerce.products (id, sku, name, product_type, status) VALUES ($1, $2, 'Test reward', 'digital_item', 'active')",
      [ids.product, sku]
    );
    const order = await pool.query<{ id: string }>(
      `INSERT INTO commerce.orders
        (principal_id, currency, subtotal_minor, tax_minor, total_minor, idempotency_key)
       VALUES ($1, 'USD', 100, 0, 100, $2)
       RETURNING id`,
      [ids.userPrincipal, `order-${suffix}`]
    );
    const orderItem = await pool.query<{ id: string }>(
      `INSERT INTO commerce.order_items
        (order_id, product_id, sku_snapshot, name_snapshot, quantity, unit_amount_minor, line_total_minor)
       VALUES ($1, $2, $3, 'Test reward', 1, 100, 100)
       RETURNING id`,
      [order.rows[0].id, ids.product, sku]
    );
    await pool.query(
      `INSERT INTO commerce.entitlements
        (id, principal_id, product_id, order_item_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [ids.entitlement, ids.userPrincipal, ids.product, orderItem.rows[0].id]
    );
    await pool.query(
      `INSERT INTO commerce.reward_queue
        (id, entitlement_id, game_key, server_id, target_external_id, delivery_payload, idempotency_key)
       VALUES ($1, $2, '7dtd', $3, 'steam-test-player', $4::jsonb, $5)`,
      [ids.reward, ids.entitlement, ids.publicServer, JSON.stringify({ itemId: "test-item", quantity: 1 }), `reward-${suffix}`]
    );

    await pool.query(
      "INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'service', 'active')",
      [ids.servicePrincipal]
    );
    await pool.query(
      "INSERT INTO core.service_accounts (principal_id, application_name) VALUES ($1, $2)",
      [ids.servicePrincipal, applicationName]
    );
    await pool.query(
      "INSERT INTO core.service_credentials (principal_id, credential_hash, label) VALUES ($1, $2, 'integration-test')",
      [ids.servicePrincipal, hashServiceToken(token)]
    );
    await pool.query(
      `INSERT INTO core.principal_role_assignments (principal_id, role_id, scope_type, scope_id)
       SELECT $1, id, 'server', $2 FROM core.roles WHERE role_key = 'reward_worker'`,
      [ids.servicePrincipal, ids.publicServer]
    );

    const publicResponse = await app.inject({ method: "GET", url: "/servers" });
    assert.equal(publicResponse.statusCode, 200);
    const publicServers = publicResponse.json().data;
    assert.equal(publicServers.some((server) => server.id === ids.publicServer), true);
    assert.equal(publicServers.some((server) => server.id === ids.privateServer), false);
    const listed = publicServers.find((server) => server.id === ids.publicServer);
    assert.equal(listed.publicHostname, "public.example.test");
    assert.equal(listed.gamePort, 26900);
    assert.equal(listed.playerCount, 3);

    const claimResponse = await app.inject({
      method: "POST",
      url: `/integrations/servers/${ids.publicServer}/rewards/claim`,
      headers: { authorization: `Bearer ${token}` },
      payload: { limit: 5 },
    });
    assert.equal(claimResponse.statusCode, 200, claimResponse.body);
    const claimed = claimResponse.json().data;
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, ids.reward);
    assert.equal(claimed[0].attempts, 1);

    const ackResponse = await app.inject({
      method: "POST",
      url: `/integrations/servers/${ids.publicServer}/rewards/${ids.reward}/ack`,
      headers: { authorization: `Bearer ${token}` },
      payload: { outcome: "delivered", response: { receipt: "test-grant" } },
    });
    assert.equal(ackResponse.statusCode, 202, ackResponse.body);
    assert.equal(ackResponse.json().data.duplicate, false);

    const duplicateAck = await app.inject({
      method: "POST",
      url: `/integrations/servers/${ids.publicServer}/rewards/${ids.reward}/ack`,
      headers: { authorization: `Bearer ${token}` },
      payload: { outcome: "delivered", response: { receipt: "test-grant" } },
    });
    assert.equal(duplicateAck.statusCode, 202);
    assert.equal(duplicateAck.json().data.duplicate, true);

    const stored = await pool.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM commerce.reward_queue WHERE id = $1",
      [ids.reward]
    );
    assert.equal(stored.rows[0].status, "delivered");
    assert.equal(stored.rows[0].attempts, 1);
  } finally {
    await pool.query("DELETE FROM operations.audit_logs WHERE actor_principal_id = $1 OR resource_id = ANY($2::text[])", [
      ids.servicePrincipal,
      [ids.publicServer, ids.privateServer, ids.reward],
    ]);
    await pool.query("DELETE FROM commerce.reward_attempts WHERE reward_id = $1", [ids.reward]);
    await pool.query("DELETE FROM commerce.reward_queue WHERE id = $1", [ids.reward]);
    await pool.query("DELETE FROM commerce.entitlements WHERE id = $1", [ids.entitlement]);
    await pool.query("DELETE FROM commerce.order_items WHERE product_id = $1", [ids.product]);
    await pool.query("DELETE FROM commerce.orders WHERE principal_id = $1", [ids.userPrincipal]);
    await pool.query("DELETE FROM commerce.products WHERE id = $1", [ids.product]);
    await pool.query("DELETE FROM core.service_credentials WHERE principal_id = $1", [ids.servicePrincipal]);
    await pool.query("DELETE FROM core.principal_role_assignments WHERE principal_id = $1", [ids.servicePrincipal]);
    await pool.query("DELETE FROM core.service_accounts WHERE principal_id = $1", [ids.servicePrincipal]);
    await pool.query("DELETE FROM core.users WHERE principal_id = $1", [ids.userPrincipal]);
    await pool.query("DELETE FROM core.principals WHERE id = ANY($1::uuid[])", [[ids.userPrincipal, ids.servicePrincipal]]);
    await pool.query("DELETE FROM operations.server_heartbeats WHERE server_id = ANY($1::uuid[])", [[ids.publicServer, ids.privateServer]]);
    await pool.query("DELETE FROM core.servers WHERE id = ANY($1::uuid[])", [[ids.publicServer, ids.privateServer]]);
    await pool.query("DELETE FROM core.clusters WHERE id = $1", [ids.cluster]);
    await app.close();
    await pool.end();
  }
});
