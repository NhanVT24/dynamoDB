import { z } from "zod";

const categoryValues = [
  "Thoi trang",
  "Dien tu",
  "Gia dung",
  "Me va be",
  "Lam dep",
  "Bach hoa"
];

const statusValues = ["active", "low_stock", "out_of_stock"];

export const createShoppingItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(categoryValues),
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
  featured: z.coerce.boolean().default(false)
});

export const updateShoppingItemSchema = createShoppingItemSchema.partial();
export const shoppingCategories = categoryValues;
export const shoppingStatuses = statusValues;
