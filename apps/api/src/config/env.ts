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
  SQS_NOTIFICATIONS_QUEUE_URL: z.string().optional(),
  SQS_AUDIT_QUEUE_URL: z.string().optional(),
  SQS_PAYMENT_EVENTS_QUEUE_URL: z.string().optional(),
  SQS_STOREFRONT_ORDERS_QUEUE_URL: z.string().optional(),
  SQS_CHECKOUT_GATE_QUEUE_URL: z.string().optional(),
  SQS_IMAGE_UPLOADS_QUEUE_URL: z.string().optional(),
  SQS_NOTIFICATIONS_DLQ_URL: z.string().optional(),
  SQS_STOREFRONT_ORDERS_DLQ_URL: z.string().optional(),
  SQS_PAYMENT_EVENTS_DLQ_URL: z.string().optional(),
  SQS_IMAGE_UPLOADS_DLQ_URL: z.string().optional(),
  SQS_EVENTBRIDGE_TARGET_DLQ_URL: z.string().optional(),
  EVENTBRIDGE_BUS_NAME: z.string().optional(),
  EVENTBRIDGE_DEFAULT_BUS_NAME: z.string().optional(),
  EVENTBRIDGE_COMMERCE_BUS_NAME: z.string().optional(),
  EVENTBRIDGE_PAYMENT_BUS_NAME: z.string().optional(),
  EVENTBRIDGE_PLATFORM_BUS_NAME: z.string().optional(),
  EVENTBRIDGE_COMMERCE_ARCHIVE_ARN: z.string().optional(),
  EVENTBRIDGE_PAYMENT_ARCHIVE_ARN: z.string().optional(),
  EVENTBRIDGE_PLATFORM_ARCHIVE_ARN: z.string().optional(),
  STOREFRONT_SYNC_QUEUE_PROCESSING: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  CHECKOUT_GATE_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(15000).default(0),
  SNS_ADMIN_ALERTS_TOPIC_ARN: z.string().optional(),
  SES_FROM_EMAIL: z.string().email().optional(),
  ADMIN_REPORT_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  VNPAY_TMN_CODE: z.string().min(1),
  VNPAY_HASH_SECRET: z.string().min(1),
  VNPAY_PAYMENT_URL: z.string().url().default("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"),
  VNPAY_RETURN_URL: z.string().url(),
  VNPAY_IPN_URL: z.string().url(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
}).parse(process.env);

export type Env = typeof env;
