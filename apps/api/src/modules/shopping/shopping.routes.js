import { z } from "zod";
import {
  createShoppingItem,
  deleteShoppingItem,
  getShoppingItem,
  getShoppingItemAll,
  incrementItemValue,
  listShoppingItemsByPage,
  listShoppingItems,
  updateShoppingItem
} from "./shopping.repository.js";
import { createShoppingItemSchema, updateShoppingItemSchema } from "./shopping.schema.js";

const paramsSchema = z.object({ id: z.uuid() });

export const shoppingRoutes = async (app) => {
  app.get("/", async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      page: z.coerce.number().int().min(1).optional(),
      cursor: z.string().optional()
    }).parse(request.query);

    if (query.page) {
      return listShoppingItemsByPage(query.page, query.limit);
    }

    return listShoppingItems(query.limit, query.cursor);
  });

  app.get("/all", async (request) => {
    const query = z.object({
      pageLimit: z.coerce.number().int().min(1).max(100).default(50),
      maxPages: z.coerce.number().int().min(1).max(100).default(20)
    }).parse(request.query);

    return getShoppingItemAll(query.pageLimit, query.maxPages);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const item = await getShoppingItem(id);
    return item ?? reply.code(404).send({ message: "Shopping item not found" });
  });

  app.post("/", async (request, reply) => {
    const input = createShoppingItemSchema.parse(request.body);
    return reply.code(201).send(await createShoppingItem(input));
  });

  app.patch("/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = updateShoppingItemSchema.extend({
      version: z.number().int().positive()
    }).parse(request.body);
    const { version, ...patch } = body;
    return updateShoppingItem(id, patch, version);
  });

  app.patch("/:id/increment", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = z.object({
      field: z.enum(["quantity"]).default("quantity"),
      incrementBy: z.coerce.number().int().min(-999).max(999)
    }).parse(request.body);

    return incrementItemValue(id, body.field, body.incrementBy);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await deleteShoppingItem(id);
    return reply.code(204).send();
  });
};
