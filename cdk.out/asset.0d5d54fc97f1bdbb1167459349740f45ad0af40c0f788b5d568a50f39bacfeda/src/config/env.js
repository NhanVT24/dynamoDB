import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../../.env"), quiet: true });
export const env = z.object({
    PORT: z.coerce.number().default(4000),
    AWS_REGION: z.string().default("ap-southeast-1"),
    AWS_ACCESS_KEY_ID: z.string().default("local"),
    AWS_SECRET_ACCESS_KEY: z.string().default("local"),
    DYNAMODB_ENDPOINT: z.string().optional(),
    DYNAMODB_TABLE_NAME: z.string().default("MarketplaceProducts"),
    S3_BUCKET_NAME: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.string().optional(),
    S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    S3_FORCE_PATH_STYLE: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => value === "true")
}).parse(process.env);
