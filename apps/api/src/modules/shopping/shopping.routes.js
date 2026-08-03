import { z } from "zod";
import {
  createShoppingItem,
  deleteShoppingItem,
  getCursorForPage,
  getMockShoppingItem,
  getShoppingItem,
  getShoppingItemAll,
  listMockShoppingItems,
  incrementItemValue,
  listShoppingItems,
  updateShoppingItem
} from "./shopping.repository.js";
import {
  createShoppingItemSchema,
  normalizeCategory,
  shoppingCategories,
  shoppingStatuses,
  updateShoppingItemSchema
} from "./shopping.schema.js";

const paramsSchema = z.object({ id: z.uuid() });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(shoppingStatuses).optional(),
  updatedAtFrom: z.string().trim().min(1).optional(),
  searchField: z.enum(["name", "brand"]).default("name"),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(["price", "stock"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional()
});

export const shoppingRoutes = async (app) => {
  app.get("/demo", async () => listMockShoppingItems());

  app.get("/demo/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const item = getMockShoppingItem(id);
    return item ?? reply.code(404).send({ message: "Mock product not found" });
  });

  app.get("/meta", async () => ({
    categories: shoppingCategories,
    statuses: shoppingStatuses,
    searchFields: ["name", "brand"]
  }));

  app.get("/", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const filters = {
      category: normalizeCategory(query.category),
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    };

    return listShoppingItems(query.limit, query.cursor, filters);
  });

  app.get("/all", async (request) => {
    const query = z.object({
      pageLimit: z.coerce.number().int().min(1).max(100).default(50),
      maxPages: z.coerce.number().int().min(1).max(100).default(20),
      category: z.string().optional(),
      status: z.enum(shoppingStatuses).optional(),
      updatedAtFrom: z.string().trim().min(1).optional(),
      searchField: z.enum(["name", "brand"]).default("name"),
      search: z.string().trim().min(1).optional(),
      sortBy: z.enum(["price", "stock"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional()
    }).parse(request.query);

    return getShoppingItemAll(query.pageLimit, query.maxPages, {
      category: normalizeCategory(query.category),
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
    });
  });

  app.get("/page-cursor", async (request) => {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(12),
      category: z.string().optional(),
      status: z.enum(shoppingStatuses).optional(),
      updatedAtFrom: z.string().trim().min(1).optional(),
      searchField: z.enum(["name", "brand"]).default("name"),
      search: z.string().trim().min(1).optional(),
      sortBy: z.enum(["price", "stock"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional()
    }).parse(request.query);

    return getCursorForPage(query.page, query.limit, {
      category: normalizeCategory(query.category),
      status: query.status,
      updatedAtFrom: query.updatedAtFrom,
      searchField: query.searchField,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection
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
