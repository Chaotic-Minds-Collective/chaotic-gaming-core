import type { FastifyInstance } from "fastify";
import { authenticateService, requireServiceScope } from "../security/service-auth.js";

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/v1/internal/whoami",
    { preHandler: [authenticateService, requireServiceScope("core:identity:read")] },
    async (request) => ({
      principalId: request.servicePrincipal?.id,
      application: request.servicePrincipal?.applicationName,
      scopes: request.serviceScopes ?? []
    })
  );
}
