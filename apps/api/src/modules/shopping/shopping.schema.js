import { z } from "zod";

const categoryValues = [
  "Th\u1eddi trang",
  "\u0110i\u1ec7n t\u1eed",
  "Gia d\u1ee5ng",
  "M\u1eb9 v\u00e0 b\u00e9",
  "L\u00e0m \u0111\u1eb9p",
  "B\u00e1ch h\u00f3a"
];

const categoryAliases = new Map([
  ["thoi trang", "Th\u1eddi trang"],
  ["th\u1eddi trang", "Th\u1eddi trang"],
  ["th\u00e1\u00bb\u009di trang", "Th\u1eddi trang"],
  ["dien tu", "\u0110i\u1ec7n t\u1eed"],
  ["\u0111i\u1ec7n t\u1eed", "\u0110i\u1ec7n t\u1eed"],
  ["\u00e4\u0091i\u00e1\u00bb\u2021n t\u00e1\u00bb\u00ad", "\u0110i\u1ec7n t\u1eed"],
  ["gia dung", "Gia d\u1ee5ng"],
  ["gia d\u1ee5ng", "Gia d\u1ee5ng"],
  ["gia d\u00e1\u00bb\u00a5ng", "Gia d\u1ee5ng"],
  ["me va be", "M\u1eb9 v\u00e0 b\u00e9"],
  ["m\u1eb9 v\u00e0 b\u00e9", "M\u1eb9 v\u00e0 b\u00e9"],
  ["m\u00e1\u00ba\u00b9 v\u00c3\u00a0 b\u00c3\u00a9", "M\u1eb9 v\u00e0 b\u00e9"],
  ["lam dep", "L\u00e0m \u0111\u1eb9p"],
  ["l\u00e0m \u0111\u1eb9p", "L\u00e0m \u0111\u1eb9p"],
  ["l\u00c3\u00a0m \u00c4\u2018\u00e1\u00ba\u00b9p", "L\u00e0m \u0111\u1eb9p"],
  ["bach hoa", "B\u00e1ch h\u00f3a"],
  ["b\u00e1ch h\u00f3a", "B\u00e1ch h\u00f3a"],
  ["b\u00c3\u00a1ch h\u00c3\u00b3a", "B\u00e1ch h\u00f3a"]
]);

export function normalizeCategory(category) {
  if (!category) return category;
  return categoryAliases.get(String(category).trim().toLowerCase()) ?? category;
}

const categorySchema = z.preprocess((value) => normalizeCategory(value), z.enum(categoryValues));

const statusValues = ["active", "low_stock", "out_of_stock"];

export const createShoppingItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: categorySchema,
  brand: z.string().trim().min(2).max(80),
  sku: z.string().trim().min(3).max(40),
  stock: z.coerce.number().int().min(0).max(999999),
  price: z.coerce.number().min(1000).max(999999999),
  originalPrice: z.coerce.number().min(1000).max(999999999).optional(),
  imageUrl: z.string().url().max(500),
  location: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(500),
  rating: z.coerce.number().min(0).max(5).default(4.8),
  soldCount: z.coerce.number().int().min(0).max(999999).default(0),
  featured: z.coerce.boolean().default(false),
  color: z.string().trim().min(2).max(40).optional(),
  size: z.string().trim().min(1).max(20).optional(),
  material: z.string().trim().min(2).max(60).optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
  voltage: z.string().trim().min(2).max(30).optional(),
  capacityLiters: z.coerce.number().min(0.1).max(9999).optional(),
  ageRange: z.string().trim().min(2).max(40).optional(),
  skinType: z.string().trim().min(2).max(40).optional(),
  weightGrams: z.coerce.number().int().min(1).max(100000).optional(),
  expiryDate: z.string().trim().min(8).max(40).optional()
});

export const updateShoppingItemSchema = createShoppingItemSchema.partial();
export const shoppingCategories = categoryValues;
export const shoppingStatuses = statusValues;
