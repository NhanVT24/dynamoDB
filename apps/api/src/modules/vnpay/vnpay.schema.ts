import { z } from "zod";

export const vnpayCheckoutItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(50)
});

export const createVnpayPaymentSchema = z.object({
  email: z.string().email().optional(),
  items: z.array(vnpayCheckoutItemSchema).min(1).max(20),
  orderDescription: z.string().trim().min(3).max(255).optional(),
  locale: z.enum(["vn", "en"]).default("vn"),
  bankCode: z.string().trim().min(2).max(20).optional()
});

export type CreateVnpayPaymentInput = z.infer<typeof createVnpayPaymentSchema>;

export const createVnpayFailureTestSchema = z.object({
  mode: z.enum(["cancel", "timeout"]),
  amount: z.coerce.number().positive().max(1_000_000_000).default(1_036_500),
  orderInfo: z.string().trim().min(3).max(255).optional(),
  bankCode: z.string().trim().min(2).max(20).default("VNPAY")
});

export type CreateVnpayFailureTestInput = z.infer<typeof createVnpayFailureTestSchema>;
