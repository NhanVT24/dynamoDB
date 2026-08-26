import { z } from "zod";

const productIds = z.array(z.string().trim().min(1).max(100)).min(1).max(100).transform((ids) => [...new Set(ids)]);

export const createSaleCampaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  discountPercent: z.coerce.number().int().min(1).max(95),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  productIds
});

export const updateSaleCampaignSchema = createSaleCampaignSchema.partial();
export type CreateSaleCampaignInput = z.infer<typeof createSaleCampaignSchema>;
