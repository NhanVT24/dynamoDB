import { z } from "zod";
const categoryValues = [
    "Thoi trang",
    "Dien tu",
    "Gia dung",
    "Me va be",
    "Lam dep",
    "Bach hoa"
];
const categoryAliases = new Map([
    ["thoi trang", "Thoi trang"],
    ["dien tu", "Dien tu"],
    ["gia dung", "Gia dung"],
    ["me va be", "Me va be"],
    ["lam dep", "Lam dep"],
    ["bach hoa", "Bach hoa"]
]);
export function normalizeCategory(category) {
    if (!category)
        return category;
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
export const shoppingCategories = [...categoryValues];
export const shoppingStatuses = [...statusValues];
