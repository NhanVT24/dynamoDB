import type { UserAddress } from "./domain/user-address.js";
import { z } from "zod";

const wardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  houseNumber: z.string().trim().max(40).default(""),
  streetNumber: z.string().trim().max(120).default("")
}).strict();

export const userAddressSchema = z.object({
  ward: z.union([wardSchema, z.string().trim().min(1).max(120)
    .transform((name) => ({ name, houseNumber: "", streetNumber: "" }))]),
  city: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120)
}).strict();

export type { UserAddress } from "./domain/user-address.js";

export function normalizeAddresses(value: unknown): UserAddress[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = userAddressSchema.safeParse(item);
    return parsed.success ? [parsed.data as UserAddress] : [];
  });
}
