import "reflect-metadata";
import { z } from "zod";
import { sendBulkSaleEmailBatch } from "../../../integrations/ses/bulk-mailer.js";

const emailJobSchema = z.object({
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

type SqsRecord = { body?: string; messageId?: string; eventSource?: string };

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
      console.log(JSON.stringify({
        flow: "email_campaign",
        stage: "email_worker_started",
        campaignId: job.campaignId,
        emailJobId: job.emailJobId,
        batchIndex: job.batchIndex,
        batchCount: job.batchCount,
        recipientCount: job.recipients.length,
        sqsMessageId: record.messageId ?? ""
      }));

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
