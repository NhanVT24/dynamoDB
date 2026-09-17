import "reflect-metadata";
import { z } from "zod";
import { sendBulkSaleEmailBatch } from "../../../integrations/ses/bulk-mailer.js";
import { sendWelcomeEmail } from "../../../integrations/ses/welcome-mailer.js";
import { markEmailRouteProcessing } from "../../../modules/email-deliveries/email-route.repository.js";

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

const emailJobSchema = z.discriminatedUnion("type", [
  saleCampaignEmailJobSchema,
  welcomeEmailJobSchema
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

      if (job.type === "email.account_welcome.requested") {
        console.log(JSON.stringify({
          flow: "account_welcome_email",
          stage: "email_worker_started",
          emailJobId: job.emailJobId,
          userSub: job.userSub,
          sqsMessageId: record.messageId ?? ""
        }));

        const result = await sendWelcomeEmail({
          emailJobId: job.emailJobId,
          userSub: job.userSub,
          toEmail: job.toEmail,
          displayName: job.displayName
        });

        console.log(JSON.stringify({
          flow: "account_welcome_email",
          stage: result.status === "already_processed"
            ? "email_worker_deduplicated"
            : result.status === "accepted"
              ? "ses_accepted"
              : result.status === "partial_sent"
                ? "ses_partially_accepted"
                : "ses_rejected",
          emailJobId: result.emailId,
          status: result.status
        }));
        continue;
      }

      const routeAdvanced = await markEmailRouteProcessing(job.emailJobId);
      console.log(JSON.stringify({
        flow: "email_campaign",
        stage: "email_worker_started",
        campaignId: job.campaignId,
        emailJobId: job.emailJobId,
        batchIndex: job.batchIndex,
        batchCount: job.batchCount,
        recipientCount: job.recipients.length,
        sqsMessageId: record.messageId ?? "",
        routeTracked: routeAdvanced
      }));

      // This opt-in hook is disabled by default. Test mode "fail" drives a
      // message to the DLQ; after an operator fixes the cause, mode "recover"
      // lets the same redriven message succeed without calling SES.
      if (testOnly && process.env.EMAIL_WORKER_TEST_MODE === "fail") {
        throw new Error(`Injected failure for DLQ test at receive ${currentReceiveCount}.`);
      }
      if (testOnly?.skipSesOnSuccess && process.env.EMAIL_WORKER_TEST_MODE === "recover") {
        console.log(JSON.stringify({
          flow: "email_campaign",
          stage: "email_worker_test_recovered",
          campaignId: job.campaignId,
          emailJobId: job.emailJobId,
          receiveCount: currentReceiveCount,
          sqsMessageId: record.messageId ?? ""
        }));
        continue;
      }

      const result = await sendBulkSaleEmailBatch({
        emailId: job.emailJobId,
        senderEmail: job.senderEmail,
        recipients: job.recipients,
        subject: job.subject,
        html: job.html,
        text: job.text,
        relatedId: job.campaignId
      });

      console.log(JSON.stringify({
        flow: "email_campaign",
        // SES API acceptance and mailbox delivery are distinct states. Never
        // label an API rejection/ambiguous result as a successful send.
        stage: result.status === "already_processed"
          ? "email_worker_deduplicated"
          : result.status === "accepted"
            ? "ses_accepted"
            : result.status === "partial_sent"
              ? "ses_partially_accepted"
              : result.status === "failed"
                ? "ses_rejected"
                : "ses_outcome_unknown",
        campaignId: job.campaignId,
        emailJobId: job.emailJobId,
        batchIndex: job.batchIndex,
        recipientCount: job.recipients.length,
        status: result.status,
        failureReason: result.failureReason ?? ""
      }));
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
