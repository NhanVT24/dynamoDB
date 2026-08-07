import { z } from "zod";

const allowedContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const createUploadPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(allowedContentTypes),
  scope: z.string().trim().min(1).max(40).default("products")
});

export type CreateUploadPresignInput = z.infer<typeof createUploadPresignSchema>;
