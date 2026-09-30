import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { buildAuditLogRecord, parseAuditLogMessage, parseAuditStreamMessage, type AuditLogRecord } from "../../../modules/audit-log/audit-log.js";

type SqsRecord = { body?: string; messageId?: string };
type SqsEvent = { Records?: SqsRecord[] };
const db = new DynamoDBClient({});

export async function processAuditLogMessages(
  event: SqsEvent,
  write: (audit: AuditLogRecord) => Promise<void>
) {
  const records = event.Records ?? [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    try {
      if (!record.body) throw new Error("Audit log queue message is empty.");
      const message: unknown = JSON.parse(record.body);
      const audit = typeof message === "object" && message !== null && "entityType" in message && message.entityType === "AUDIT_LOG"
        ? parseAuditLogMessage(record.body)
        : buildAuditLogRecord(parseAuditStreamMessage(message));
      if (!audit) continue;
      await write(audit);
      console.info("[audit-log] recorded", {
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        action: audit.action,
        changes: Object.keys(audit.changes)
      });
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") continue;
      console.error("[audit-log] write_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      if (records.slice(index).some((item) => !item.messageId)) throw error;
      return {
        batchItemFailures: records.slice(index).map((item) => ({ itemIdentifier: item.messageId! }))
      };
    }
  }
  return { batchItemFailures: [] };
}

export async function handler(event: SqsEvent) {
  const tableName = process.env.AUDIT_LOG_TABLE_NAME;
  if (!tableName) throw new Error("AUDIT_LOG_TABLE_NAME is required for audit log.");

  return processAuditLogMessages(event, async (audit) => {
    await db.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(audit, { removeUndefinedValues: true }),
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    }));
  });
}

