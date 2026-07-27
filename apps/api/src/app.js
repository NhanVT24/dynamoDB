import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { learningRoutes } from "./modules/learning/learning.routes.js";
import { shoppingRoutes } from "./modules/shopping/shopping.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedDevOrigin =
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);

      return callback(null, allowedDevOrigin);
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(shoppingRoutes, { prefix: "/api/shopping-items" });
  await app.register(learningRoutes, { prefix: "/api/learning" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError || Array.isArray(error.issues)) {
      return reply.code(400).send({ message: "Invalid request", issues: error.issues });
    }
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return reply.code(409).send({ message: "Record changed, missing, or condition failed" });
    }
    app.log.error(error);
    return reply.code(500).send({ message: "Internal server error" });
  });
  return app;
}
