import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createStudent,
  deleteStudent,
  getStudent,
  listStudents,
  updateStudent
} from "./student.repository.js";
import { createStudentSchema, updateStudentSchema } from "./student.schema.js";

const paramsSchema = z.object({ id: z.uuid() });

export const studentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().optional()
    }).parse(request.query);
    return listStudents(query.limit, query.cursor);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const student = await getStudent(id);
    return student ?? reply.code(404).send({ message: "Student not found" });
  });

  app.post("/", async (request, reply) => {
    const input = createStudentSchema.parse(request.body);
    return reply.code(201).send(await createStudent(input));
  });

  app.patch("/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = updateStudentSchema.extend({
      version: z.number().int().positive()
    }).parse(request.body);
    const { version, ...patch } = body;
    return updateStudent(id, patch, version);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await deleteStudent(id);
    return reply.code(204).send();
  });
};
