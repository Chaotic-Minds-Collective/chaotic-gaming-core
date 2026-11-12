import type { FastifyInstance } from "fastify";
import { authenticateServiceToken, bearerToken } from "../security/serviceAuth.js";

export async function registerServiceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/service/ping", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const service = await authenticateServiceToken(token);
    if (!service) return reply.code(401).send({ error: "unauthorized" });
    return { authenticated: true, principalId: service.principalId, application: service.applicationName };
  });
}
