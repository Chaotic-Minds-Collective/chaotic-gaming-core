import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canTransitionPluginState } from "../../plugins/registry/src/registry.js";
import { validatePluginManifest } from "../../plugins/registry/src/manifest.js";
import { requireServicePermission } from "../auth/service.js";
import { pool } from "../db.js";

const registrationSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/i).optional(),
  artifactUrl: z.string().url().optional()
});

const desiredStateSchema = z.object({
  desiredState: z.enum(["enabled", "disabled"])
});

const healthSchema = z.object({
  lifecycleStatus: z.enum(["VALIDATED", "ENABLED", "HEALTHY", "DEGRADED", "DISABLED", "REMOVED"]),
  healthMessage: z.string().max(1000).nullable().optional()
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Plugin manifest validation failed.";
}

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  app.get("/plugins", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Plugin catalogue is temporarily unavailable." } });
    const result = await pool.query(
      `SELECT plugin_id AS id, name, game, latest_version AS "latestVersion",
              lifecycle_status AS status, manifest->'capabilities' AS capabilities
         FROM core.plugins
        WHERE lifecycle_status <> 'REMOVED'
        ORDER BY game, name`
    );
    return { data: result.rows, requestId: request.id };
  });

  app.post("/plugins", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Plugin registration is temporarily unavailable." } });
    const actorId = await requireServicePermission(request, reply, "plugins.manage", "platform", null);
    if (!actorId) return;

    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid plugin manifest is required." } });
    }

    let manifest;
    try {
      manifest = validatePluginManifest(parsed.data.manifest);
    } catch (error) {
      return reply.code(400).send({ error: { code: "INVALID_PLUGIN_MANIFEST", message: errorMessage(error) } });
    }

    if (parsed.data.artifactUrl && new URL(parsed.data.artifactUrl).protocol !== "https:") {
      return reply.code(400).send({ error: { code: "INSECURE_ARTIFACT_URL", message: "Plugin artifact URLs must use HTTPS." } });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ game: string }>(
        "SELECT game FROM core.plugins WHERE plugin_id = $1 FOR UPDATE",
        [manifest.id]
      );
      if (existing.rows[0] && existing.rows[0].game !== manifest.game) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "PLUGIN_ID_CONFLICT", message: "A plugin ID cannot change its game target." } });
      }

      const missingDependencies = await client.query<{ dependency_id: string }>(
        `SELECT dependency_id
           FROM unnest($1::text[]) AS dependency_id
          WHERE NOT EXISTS (SELECT 1 FROM core.plugins p WHERE p.plugin_id = dependency_id)`,
        [manifest.dependencies]
      );
      if (missingDependencies.rows.length > 0) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: {
            code: "PLUGIN_DEPENDENCY_MISSING",
            message: "Register required plugin dependencies before this plugin.",
            details: { dependencies: missingDependencies.rows.map((row) => row.dependency_id) }
          }
        });
      }

      await client.query(
        `INSERT INTO core.plugins (plugin_id, name, game, latest_version, lifecycle_status, manifest)
         VALUES ($1, $2, $3, $4, 'VALIDATED', $5::jsonb)
         ON CONFLICT (plugin_id) DO UPDATE
           SET name = EXCLUDED.name,
               latest_version = EXCLUDED.latest_version,
               manifest = EXCLUDED.manifest,
               updated_at = NOW()`,
        [manifest.id, manifest.name, manifest.game, manifest.version, JSON.stringify(manifest)]
      );

      const version = await client.query<{ id: string }>(
        `INSERT INTO core.plugin_versions
          (plugin_id, version, api_version, manifest, artifact_digest, artifact_url)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (plugin_id, version) DO NOTHING
         RETURNING id`,
        [
          manifest.id,
          manifest.version,
          manifest.apiVersion,
          JSON.stringify(manifest),
          parsed.data.artifactDigest ?? null,
          parsed.data.artifactUrl ?? null
        ]
      );
      const versionRow = version.rows[0] ?? (await client.query<{ id: string }>(
        "SELECT id FROM core.plugin_versions WHERE plugin_id = $1 AND version = $2",
        [manifest.id, manifest.version]
      )).rows[0];
      if (!versionRow) throw new Error("Plugin version registration failed.");

      for (const dependencyId of manifest.dependencies) {
        await client.query(
          `INSERT INTO core.plugin_dependencies (plugin_version_id, dependency_plugin_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [versionRow.id, dependencyId]
        );
      }

      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome)
         VALUES ($1, 'plugin.register', 'plugin', $2, 'success')`,
        [actorId, manifest.id]
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        data: { id: manifest.id, name: manifest.name, version: manifest.version, status: "VALIDATED" },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Plugin registration failed");
      return reply.code(500).send({ error: { code: "PLUGIN_REGISTRATION_FAILED", message: "The plugin could not be registered." } });
    } finally {
      client.release();
    }
  });

  app.get("/servers/:serverId/plugins", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Plugin installations are temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "INVALID_SERVER_ID", message: "A valid server UUID is required." } });
    const actorId = await requireServicePermission(request, reply, "plugins.read", "server", params.data.serverId);
    if (!actorId) return;

    const result = await pool.query(
      `SELECT i.id, i.plugin_id AS "pluginId", p.name, p.game,
              v.version, i.lifecycle_status AS "lifecycleStatus",
              i.desired_state AS "desiredState", i.health_message AS "healthMessage",
              i.last_health_at AS "lastHealthAt", i.updated_at AS "updatedAt"
         FROM core.plugin_installations i
         JOIN core.plugins p ON p.plugin_id = i.plugin_id
         LEFT JOIN core.plugin_versions v ON v.id = i.plugin_version_id
        WHERE i.server_id = $1
        ORDER BY p.name`,
      [params.data.serverId]
    );
    return { data: result.rows, requestId: request.id };
  });

  app.post("/servers/:serverId/plugins/:pluginId/state", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Plugin state changes are temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid(), pluginId: z.string().min(3).max(200) }).safeParse(request.params);
    const body = desiredStateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server, plugin and desired state are required." } });
    const actorId = await requireServicePermission(request, reply, "plugins.manage", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{ game_key: string; plugin_version_id: string; plugin_game: string; plugin_status: string }>(
        `SELECT s.game_key, pv.id AS plugin_version_id, p.game AS plugin_game, p.lifecycle_status AS plugin_status
           FROM core.servers s
           JOIN core.plugins p ON p.plugin_id = $2
           JOIN core.plugin_versions pv ON pv.plugin_id = p.plugin_id AND pv.version = p.latest_version
          WHERE s.id = $1 AND s.status <> 'deleted'
          LIMIT 1`,
        [params.data.serverId, params.data.pluginId]
      );
      const record = target.rows[0];
      if (!record || (record.plugin_game !== "platform" && record.plugin_game !== record.game_key)) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "PLUGIN_OR_SERVER_NOT_FOUND", message: "The plugin is not available for this server." } });
      }
      if (body.data.desiredState === "enabled" && !["VALIDATED", "ENABLED", "HEALTHY", "DEGRADED"].includes(record.plugin_status)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "PLUGIN_NOT_VALIDATED", message: "Only a validated plugin can be enabled." } });
      }

      const installation = await client.query(
        `INSERT INTO core.plugin_installations
          (server_id, plugin_id, plugin_version_id, lifecycle_status, desired_state)
         VALUES ($1, $2, $3, 'DISCOVERED', $4)
         ON CONFLICT (server_id, plugin_id) DO UPDATE
           SET plugin_version_id = EXCLUDED.plugin_version_id,
               desired_state = EXCLUDED.desired_state,
               updated_at = NOW()
         RETURNING id, plugin_id AS "pluginId", lifecycle_status AS "lifecycleStatus",
                   desired_state AS "desiredState"`,
        [params.data.serverId, params.data.pluginId, record.plugin_version_id, body.data.desiredState]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'plugin.desired_state', 'plugin_installation', $2, 'success', $3::jsonb)`,
        [actorId, installation.rows[0]?.id, JSON.stringify({ serverId: params.data.serverId, desiredState: body.data.desiredState })]
      );
      await client.query("COMMIT");
      return { data: installation.rows[0], requestId: request.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Plugin desired-state update failed");
      return reply.code(500).send({ error: { code: "PLUGIN_STATE_UPDATE_FAILED", message: "The plugin state could not be updated." } });
    } finally {
      client.release();
    }
  });

  app.post("/integrations/servers/:serverId/plugins/:pluginId/health", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Plugin health reporting is temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid(), pluginId: z.string().min(3).max(200) }).safeParse(request.params);
    const body = healthSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid plugin lifecycle report is required." } });
    const actorId = await requireServicePermission(request, reply, "plugins.report", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ id: string; lifecycle_status: string; desired_state: string }>(
        `SELECT id, lifecycle_status, desired_state
           FROM core.plugin_installations
          WHERE server_id = $1 AND plugin_id = $2
          FOR UPDATE`,
        [params.data.serverId, params.data.pluginId]
      );
      const installation = current.rows[0];
      if (!installation) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "INSTALLATION_NOT_FOUND", message: "The plugin installation was not found." } });
      }
      if (!canTransitionPluginState(installation.lifecycle_status, body.data.lifecycleStatus)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "INVALID_LIFECYCLE_TRANSITION", message: `Invalid plugin transition: ${installation.lifecycle_status} -> ${body.data.lifecycleStatus}` } });
      }
      if (["ENABLED", "HEALTHY", "DEGRADED"].includes(body.data.lifecycleStatus) && installation.desired_state !== "enabled") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "PLUGIN_NOT_DESIRED", message: "The server has not been instructed to enable this plugin." } });
      }

      const updated = await client.query(
        `UPDATE core.plugin_installations
            SET lifecycle_status = $3,
                health_message = $4,
                last_health_at = CASE WHEN $3 IN ('HEALTHY', 'DEGRADED') THEN NOW() ELSE last_health_at END,
                updated_at = NOW()
          WHERE id = $1 AND server_id = $2
          RETURNING id, plugin_id AS "pluginId", lifecycle_status AS "lifecycleStatus",
                    desired_state AS "desiredState", health_message AS "healthMessage",
                    last_health_at AS "lastHealthAt"`,
        [installation.id, params.data.serverId, body.data.lifecycleStatus, body.data.healthMessage ?? null]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'plugin.health_report', 'plugin_installation', $2, 'success', $3::jsonb)`,
        [actorId, installation.id, JSON.stringify({ lifecycleStatus: body.data.lifecycleStatus })]
      );
      await client.query("COMMIT");
      return { data: updated.rows[0], requestId: request.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Plugin health report failed");
      return reply.code(500).send({ error: { code: "PLUGIN_HEALTH_REPORT_FAILED", message: "The plugin health report could not be saved." } });
    } finally {
      client.release();
    }
  });
}
