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
    DYNAMODB_TABLE_NAME: z.string().default("MarketplaceProducts")
}).parse(process.env);
