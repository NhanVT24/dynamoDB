import { z } from "zod";

export const createShoppingItemSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().min(2).max(80),
  quantity: z.coerce.number().int().min(1).max(999),
  unitPrice: z.coerce.number().min(0).max(999999999),
  priceLabel: z.string().min(1).max(80),
  purchased: z.coerce.boolean().default(false)
});

export const updateShoppingItemSchema = createShoppingItemSchema.partial();
