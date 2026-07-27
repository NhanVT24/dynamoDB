import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { learningRoutes } from "./modules/learning/learning.routes.js";
import { studentRoutes } from "./modules/students/student.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: "http://localhost:3000" });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(studentRoutes, { prefix: "/api/students" });
  await app.register(learningRoutes, { prefix: "/api/learning" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
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
