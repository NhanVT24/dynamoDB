import { z } from "zod";

const storefrontProductIdSchema = z.string().trim().transform((value) => value.replace(/^PRODUCT#/i, "")).pipe(z.uuid());

export const storefrontOrderItemSchema = z.object({
  productId: storefrontProductIdSchema,
  quantity: z.coerce.number().int().min(1).max(50)
});

export const createStorefrontOrderSchema = z.object({
  requestId: z.string().uuid().optional(),
  items: z.array(storefrontOrderItemSchema).min(1).max(20)
});

export type CreateStorefrontOrderInput = z.infer<typeof createStorefrontOrderSchema>;

export const prepareStorefrontCheckoutSchema = z.object({
  items: z.array(storefrontOrderItemSchema).min(1).max(20),
  locale: z.enum(["vn", "en"]).default("vn"),
  bankCode: z.string().trim().min(2).max(20).optional()
});

export type PrepareStorefrontCheckoutInput = z.infer<typeof prepareStorefrontCheckoutSchema>;
