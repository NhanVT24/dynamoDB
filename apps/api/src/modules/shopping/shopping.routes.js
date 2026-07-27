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
import {
  createShoppingItemSchema,
  shoppingCategories,
  shoppingStatuses,
  updateShoppingItemSchema
} from "./shopping.schema.js";

const paramsSchema = z.object({ id: z.uuid() });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(12),
  page: z.coerce.number().int().min(1).optional(),
  cursor: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(shoppingStatuses).optional(),
  search: z.string().trim().min(1).optional()
});

export const shoppingRoutes = async (app) => {
  app.get("/meta", async () => ({
    categories: shoppingCategories,
    statuses: shoppingStatuses
  }));

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const filters = {
      category: query.category,
      status: query.status,
      search: query.search
    };

    if (query.page) {
      return listShoppingItemsByPage(query.page, query.limit, filters);
    }

    return listShoppingItems(query.limit, query.cursor, filters);
  });

  app.get("/all", async (request) => {
    const query = z.object({
      pageLimit: z.coerce.number().int().min(1).max(100).default(50),
      maxPages: z.coerce.number().int().min(1).max(100).default(20),
      category: z.string().optional(),
      status: z.enum(shoppingStatuses).optional(),
      search: z.string().trim().min(1).optional()
    }).parse(request.query);

    return getShoppingItemAll(query.pageLimit, query.maxPages, {
      category: query.category,
      status: query.status,
      search: query.search
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const item = await getShoppingItem(id);
    return item ?? reply.code(404).send({ message: "Product not found" });
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
      field: z.enum(["stock", "soldCount"]).default("stock"),
      incrementBy: z.coerce.number().int().min(-99999).max(99999)
    }).parse(request.body);

    return incrementItemValue(id, body.field, body.incrementBy);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await deleteShoppingItem(id);
    return reply.code(204).send();
  });
};
