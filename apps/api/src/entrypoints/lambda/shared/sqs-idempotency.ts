import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const db = new DynamoDBClient({});
const tableName = () => process.env.DYNAMODB_IDEMPOTENCY_TABLE_NAME;

type State = "IN_PROGRESS" | "COMPLETED" | "UNKNOWN";
type RecordState = { status?: State; leaseUntil?: number };
export type IdempotencyOutcome = "completed" | "unknown";
export type IdempotencyResult = "completed" | "duplicate" | "unknown" | "busy";

function key(worker: string, id: string) {
  return { PK: `IDEMPOTENCY#${worker}#${id}`, SK: "DETAIL" };
}

// The table controls ownership of an at-least-once message. It intentionally
// does not claim exactly-once external effects: UNKNOWN requires reconciliation.
export async function runIdempotent<T>(input: {
  worker: string;
  id: string;
  leaseSeconds?: number;
  execute: () => Promise<IdempotencyOutcome>;
}): Promise<IdempotencyResult> {
  const table = tableName();
  if (!table) throw new Error("Missing DYNAMODB_IDEMPOTENCY_TABLE_NAME.");
  const now = Math.floor(Date.now() / 1000);
  const leaseUntil = now + (input.leaseSeconds ?? 120);
  const itemKey = key(input.worker, input.id);
  try {
    await db.send(new PutItemCommand({ TableName: table, Item: marshall({ ...itemKey, status: "IN_PROGRESS", leaseUntil, expiresAt: now + 30 * 86400 }), ConditionExpression: "attribute_not_exists(PK)" }));
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
    const existing = await db.send(new GetItemCommand({ TableName: table, Key: marshall(itemKey), ConsistentRead: true }));
    const state = existing.Item ? unmarshall(existing.Item) as RecordState : {};
    if (state.status === "COMPLETED") return "duplicate";
    if (state.status === "UNKNOWN") return "unknown";
    if (!state.leaseUntil || state.leaseUntil > now) return "busy";
    try {
      await db.send(new UpdateItemCommand({ TableName: table, Key: marshall(itemKey), ConditionExpression: "#status = :inProgress AND leaseUntil <= :now", UpdateExpression: "SET leaseUntil = :leaseUntil", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: marshall({ ":inProgress": "IN_PROGRESS", ":now": now, ":leaseUntil": leaseUntil }) }));
    } catch (takeoverError) {
      if ((takeoverError as { name?: string }).name === "ConditionalCheckFailedException") return "busy";
      throw takeoverError;
    }
  }

  try {
    const outcome = await input.execute();
    await db.send(new UpdateItemCommand({ TableName: table, Key: marshall(itemKey), UpdateExpression: "SET #status = :status REMOVE leaseUntil", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: marshall({ ":status": outcome === "completed" ? "COMPLETED" : "UNKNOWN" }) }));
    return outcome;
  } catch (error) {
    // Release only code failures before an ambiguous provider outcome. SQS can retry.
    await db.send(new UpdateItemCommand({ TableName: table, Key: marshall(itemKey), UpdateExpression: "SET leaseUntil = :expired", ExpressionAttributeValues: marshall({ ":expired": now - 1 }) }));
    throw error;
  }
}
