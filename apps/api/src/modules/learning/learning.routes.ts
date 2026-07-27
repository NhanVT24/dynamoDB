import type { FastifyPluginAsync } from "fastify";

export const learningRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({
    exercises: [
      "CRUD course bằng Put/Get/Update/Delete",
      "Query enrollments theo student PK",
      "Query students theo course qua GSI1",
      "TransactWrite enrollment + course capacity",
      "BatchWrite import students và retry UnprocessedItems",
      "Email uniqueness bằng lock item",
      "TTL cho audit items",
      "PartiQL: so sánh với native commands"
    ]
  }));

  app.all("/*", async (_request, reply) =>
    reply.code(501).send({ message: "Bài tập DynamoDB: hãy tự triển khai endpoint này." })
  );
};
