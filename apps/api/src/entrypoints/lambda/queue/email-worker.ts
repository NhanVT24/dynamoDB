import { createDeliverEmailJob } from "../../../modules/email-deliveries/email-background.composition.js";
import type { EmailJob } from "../../../modules/email-deliveries/domain/email-jobs.js";
import "reflect-metadata";
import { z } from "zod";
import { runIdempotent } from "../shared/sqs-idempotency.js";

const saleCampaignEmailJobSchema = z.object({
  type: z.literal("email.sale_campaign.requested"),
  campaignId: z.string().min(1),
  emailJobId: z.string().length(64),
  batchIndex: z.number().int().min(0),
  batchCount: z.number().int().min(1),
  senderEmail: z.string().email(),
  recipients: z.array(z.string().email()).min(1).max(50),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100_000),
  text: z.string().min(1).max(100_000)
});

const welcomeEmailJobSchema = z.object({
  type: z.literal("email.account_welcome.requested"),
  emailJobId: z.string().length(64),
  userSub: z.string().min(1),
  toEmail: z.string().email(),
  displayName: z.string().optional()
});

const orderConfirmationEmailJobSchema = z.object({
  type: z.literal("email.order_confirmation.requested"),
  campaignId: z.string().min(1),
  emailJobId: z.string().length(64),
  batchIndex: z.literal(0),
  batchCount: z.literal(1),
  toEmail: z.string().email(),
  orderId: z.string().min(1),
  totalAmount: z.number().nonnegative(),
  createdAt: z.string().datetime(),
  paymentConfirmedAt: z.string().datetime().optional(),
  items: z.array(z.object({
    productName: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    originalUnitPrice: z.number().nonnegative().optional(),
    lineTotal: z.number().nonnegative()
  })).min(1)
});

const emailJobSchema = z.discriminatedUnion("type", [
  saleCampaignEmailJobSchema,
  welcomeEmailJobSchema,
  orderConfirmationEmailJobSchema
]);

type SqsRecord = {
  body?: string;
  messageId?: string;
  eventSource?: string;
  attributes?: { ApproximateReceiveCount?: string };
};

const testOnlyDirectiveSchema = z.object({
  failUntilReceiveCount: z.number().int().min(0).max(10),
  skipSesOnSuccess: z.literal(true)
});

function getTestOnlyDirective(record: SqsRecord) {
  if (process.env.EMAIL_WORKER_TEST_MODE === "disabled" || !process.env.EMAIL_WORKER_TEST_MODE) return undefined;

  const envelope = JSON.parse(String(record.body ?? "")) as { detail?: unknown };
  const detail = envelope.detail ?? envelope;
  if (!detail || typeof detail !== "object") return undefined;
  const parsed = z.object({ testOnly: testOnlyDirectiveSchema.optional() }).safeParse(detail);
  return parsed.success ? parsed.data.testOnly : undefined;
}

function receiveCount(record: SqsRecord) {
  const value = Number(record.attributes?.ApproximateReceiveCount ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function detailFromRecord(record: SqsRecord) {
  const envelope = JSON.parse(String(record.body ?? "")) as { detail?: unknown };
  return emailJobSchema.parse(envelope.detail ?? envelope);
}

function normalizePipeRecords(event: unknown): SqsRecord[] {
  // EventBridge Pipes invokes Lambda with a JSON array for a source batch,
  // unlike a native Lambda SQS trigger which uses { Records: [...] }.
  const candidates = Array.isArray(event)
    ? event
    : Array.isArray((event as { Records?: unknown[] } | undefined)?.Records)
      ? (event as { Records: unknown[] }).Records
      : [];

  return candidates.filter((record): record is SqsRecord =>
    Boolean(record) && typeof (record as SqsRecord).body === "string"
  );
}

const delivery=createDeliverEmailJob();

export const handler = async (event: unknown, context?: { awsRequestId?: string }) => {
  const records = normalizePipeRecords(event);
  console.log(JSON.stringify({
    flow: "email_campaign",
    stage: "email_queue_received",
    requestId: context?.awsRequestId ?? "",
    recordCount: records.length,
    payloadShape: Array.isArray(event) ? "pipe_array" : "records_wrapper"
  }));

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of records) {
    try {
      const job = detailFromRecord(record);
      const testOnly = getTestOnlyDirective(record);
      const currentReceiveCount = receiveCount(record);

      const idempotency = await runIdempotent({
        worker: "email-worker",
        id: job.emailJobId,
        execute: async () => {

      return delivery.execute(job as EmailJob,{messageId:record.messageId,receiveCount:currentReceiveCount,
        testMode:process.env.EMAIL_WORKER_TEST_MODE,testOnly});
        }
      });
      if (idempotency === "busy") {
        throw new Error(`Email job ${job.emailJobId} is already being processed.`);
      }
      if (idempotency === "duplicate" || idempotency === "unknown") {
        console.log(JSON.stringify({ flow: "email_campaign", stage: `email_worker_${idempotency}`, emailJobId: job.emailJobId }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        flow: "email_campaign",
        stage: "email_worker_failed",
        sqsMessageId: record.messageId ?? "",
        message: error instanceof Error ? error.message : "unknown"
      }));
      if (record.messageId) batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
