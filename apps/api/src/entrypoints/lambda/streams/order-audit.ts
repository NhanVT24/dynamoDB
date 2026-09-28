import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { buildOrderAuditRecord, type OrderStreamRecord } from "../../../modules/storefront/order-audit.js";

type OrderStreamEvent = { Records?: OrderStreamRecord[] };
const db = new DynamoDBClient({});

export async function handler(event: OrderStreamEvent) {
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required for order audit.");

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records ?? []) {
    try {
      const audit = buildOrderAuditRecord(record);
      if (!audit) continue;

      await db.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(audit),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      }));
      console.info("[order-audit] recorded", { orderId: audit.orderId, eventName: audit.eventName, status: audit.status });
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") continue;
      console.error("[order-audit] failed", {
        eventId: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      if (record.dynamodb?.SequenceNumber) {
        batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      } else {
        throw error;
      }
    }
  }
  return { batchItemFailures };
}
