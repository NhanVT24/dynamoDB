import { z } from "zod";
import { shoppingStatuses } from "./shopping.schema.js";
export const shoppingParamsSchema = z.object({ id: z.uuid() });
export const shoppingListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(12),
    cursor: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(shoppingStatuses).optional(),
    updatedAtFrom: z.string().trim().min(1).optional(),
    searchField: z.enum(["name", "brand"]).default("name"),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(["price", "stock", "updatedAt"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional()
});
export const shoppingListAllQuerySchema = z.object({
    pageLimit: z.coerce.number().int().min(1).max(100).default(50),
    maxPages: z.coerce.number().int().min(1).max(100).default(20),
    category: z.string().optional(),
    status: z.enum(shoppingStatuses).optional(),
    updatedAtFrom: z.string().trim().min(1).optional(),
    searchField: z.enum(["name", "brand"]).default("name"),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(["price", "stock", "updatedAt"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional()
});
export const shoppingPageCursorQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(12),
    category: z.string().optional(),
    status: z.enum(shoppingStatuses).optional(),
    updatedAtFrom: z.string().trim().min(1).optional(),
    searchField: z.enum(["name", "brand"]).default("name"),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(["price", "stock", "updatedAt"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional()
});
export const shoppingIncrementBodySchema = z.object({
    field: z.enum(["stock", "soldCount"]).default("stock"),
    incrementBy: z.coerce.number().int().min(-99999).max(99999)
});
export const shoppingUpdateBodySchema = z.object({
    version: z.number().int().positive()
});
