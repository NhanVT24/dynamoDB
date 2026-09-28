import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { parseOrderAuditMessage, type OrderAuditRecord } from "../../../modules/storefront/order-audit.js";

type SqsRecord = { body?: string; messageId?: string };
type SqsEvent = { Records?: SqsRecord[] };
const db = new DynamoDBClient({});

export async function processOrderAuditMessages(
  event: SqsEvent,
  write: (audit: OrderAuditRecord) => Promise<void>
) {
  const records = event.Records ?? [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    try {
      const audit = parseOrderAuditMessage(record.body);
      await write(audit);
      console.info("[order-audit] recorded", { orderId: audit.orderId, eventName: audit.eventName, status: audit.status });
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") continue;
      console.error("[order-audit] write_failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      // FIFO: retry the failed message and every later message in this batch.
      if (records.slice(index).some((item) => !item.messageId)) throw error;
      return {
        batchItemFailures: records.slice(index).map((item) => ({ itemIdentifier: item.messageId! }))
      };
    }
  }
  return { batchItemFailures: [] };
}

export async function handler(event: SqsEvent) {
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required for order audit.");

  return processOrderAuditMessages(event, async (audit) => {
    await db.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(audit, { removeUndefinedValues: true }),
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    }));
  });
}
