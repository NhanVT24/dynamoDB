import crypto from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { buildOrderAuditRecord, type OrderAuditRecord, type OrderStreamRecord } from "../../../modules/storefront/order-audit.js";

type OrderStreamEvent = { Records?: OrderStreamRecord[] };
const sqs = new SQSClient({});

export async function publishOrderAuditRecords(
  event: OrderStreamEvent,
  publish: (audit: OrderAuditRecord) => Promise<void>
) {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records ?? []) {
    try {
      const audit = buildOrderAuditRecord(record);
      if (!audit) continue;

      await publish(audit);
      console.info("[order-audit] queued", { orderId: audit.orderId, changeType: audit.changeType, before: audit.before, after: audit.after });
    } catch (error) {
      console.error("[order-audit] publish_failed", {
        eventId: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      if (!record.dynamodb?.SequenceNumber) throw error;
      batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
    }
  }
  return { batchItemFailures };
}

export async function handler(event: OrderStreamEvent) {
  const queueUrl = process.env.SQS_ORDER_AUDIT_QUEUE_URL;
  if (!queueUrl) throw new Error("SQS_ORDER_AUDIT_QUEUE_URL is required for order audit.");

  return publishOrderAuditRecords(event, async (audit) => {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(audit),
      MessageGroupId: crypto.createHash("sha256").update(audit.orderId).digest("hex"),
      MessageDeduplicationId: crypto.createHash("sha256").update(audit.SK).digest("hex")
    }));
  });
}
