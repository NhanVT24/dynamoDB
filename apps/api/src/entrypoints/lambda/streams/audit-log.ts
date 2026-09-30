import crypto from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { buildAuditLogRecord, type AuditLogRecord, type AuditStreamRecord } from "../../../modules/audit-log/audit-log.js";

type AuditStreamEvent = { Records?: AuditStreamRecord[] };
const sqs = new SQSClient({});

export async function publishAuditLogRecords(
  event: AuditStreamEvent,
  publish: (audit: AuditLogRecord) => Promise<void>
) {
  for (const record of event.Records ?? []) {
    try {
      const audit = buildAuditLogRecord(record);
      if (!audit) continue;

      await publish(audit);
      console.info("[audit-log] queued", {
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        action: audit.action,
        changes: Object.keys(audit.changes)
      });
    } catch (error) {
      console.error("[audit-log] publish_failed", {
        eventId: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      if (!record.dynamodb?.SequenceNumber) throw error;
      // Retrying from this sequence also retries later records in the batch.
      // Stop here so later changes cannot reach the FIFO queue first.
      return { batchItemFailures: [{ itemIdentifier: record.dynamodb.SequenceNumber }] };
    }
  }
  return { batchItemFailures: [] };
}

export async function handler(event: AuditStreamEvent) {
  const queueUrl = process.env.SQS_AUDIT_LOG_QUEUE_URL;
  if (!queueUrl) throw new Error("SQS_AUDIT_LOG_QUEUE_URL is required for audit log.");

  return publishAuditLogRecords(event, async (audit) => {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(audit),
      MessageGroupId: crypto.createHash("sha256").update(`${audit.resourceType}:${audit.resourceId}`).digest("hex"),
      MessageDeduplicationId: crypto.createHash("sha256").update(audit.SK).digest("hex")
    }));
  });
}

