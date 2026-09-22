import { z } from "zod";

const allowedImageContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const allowedReportContentTypes = [
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
] as const;

export const createUploadPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(allowedImageContentTypes),
  scope: z.string().trim().min(1).max(40).default("products")
});

export const createReportUploadPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(allowedReportContentTypes)
});

export const createReportOpenPresignSchema = z.object({
  key: z.string().trim().min(1).max(1024)
});

export type CreateUploadPresignInput = z.infer<typeof createUploadPresignSchema>;
export type CreateReportUploadPresignInput = z.infer<typeof createReportUploadPresignSchema>;
export type CreateReportOpenPresignInput = z.infer<typeof createReportOpenPresignSchema>;
