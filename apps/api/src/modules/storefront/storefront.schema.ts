import { z } from "zod";

export const storefrontOrderItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(50)
});

export const createStorefrontOrderSchema = z.object({
  items: z.array(storefrontOrderItemSchema).min(1).max(20)
});

export type CreateStorefrontOrderInput = z.infer<typeof createStorefrontOrderSchema>;
