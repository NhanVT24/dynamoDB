import crypto from "node:crypto";
import { GetItemCommand, UpdateItemCommand, TransactWriteItemsCommand, type AttributeValue, type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { buildAuditLogRecord, type DynamoAttribute } from "./audit-log.js";
import { currentAuditContext } from "./audit-context.js";
import { auditTarget } from "./audit-resources.js";
import { rawDb } from "../../database/dynamodb/client.js";

// Caller must condition its Delete on the snapshot version/updatedAt. An audit
// write and a business delete either both commit or both fail.
export function deletionAuditPut(tableName: string, snapshot: Record<string, AttributeValue>): TransactWriteItem {
  const eventId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const image = { ...snapshot };
  delete image.auditDeleteOutbox;
  const audit = buildAuditLogRecord({
    eventID: eventId, eventName: "REMOVE",
    dynamodb: {
      Keys: { PK: snapshot.PK as DynamoAttribute, SK: snapshot.SK as DynamoAttribute },
      OldImage: image as Record<string, DynamoAttribute>,
      SequenceNumber: eventId, ApproximateCreationDateTime: timestamp
    }
  });
  if (!audit) throw new Error("Cannot build deletion audit for this resource.");
  audit.source.type = "APPLICATION_EVENT";
  delete audit.source.sequenceNumber;
  const metadata = currentAuditContext();
  audit.actor = { type: metadata.auditActorType, id: metadata.auditActorId, role: metadata.auditActorRole };
  audit.context = { ...audit.context, source: metadata.auditSource, reason: "resource_deleted",
    ...(metadata.auditRequestId ? { requestId: metadata.auditRequestId } : {}) };
  return { Put: {
    TableName: tableName,
    Item: marshall({ PK: `AUDIT_EVENT#${eventId}`, SK: "DETAIL", entityType: "AUDIT_EVENT", auditExpiresAt: timestamp + 90 * 86400, auditRecord: JSON.stringify(audit) }),
    ConditionExpression: "attribute_not_exists(PK)"
  } };
}

export async function deleteAuditedItem(tableName: string, key: Record<string, AttributeValue>, expectedUpdatedAt?: string): Promise<boolean> {
  const target = auditTarget(key.PK?.S ?? "", key.SK?.S ?? "");
  if (!target) throw new Error("Resource does not support audited deletion.");
  const result = await rawDb.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
  const snapshot = result.Item;
  if (!snapshot || (expectedUpdatedAt !== undefined && snapshot.updatedAt?.S !== expectedUpdatedAt)) return false;
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const conditions = ["attribute_exists(PK)"];
  // Compare every audited field, not only a millisecond timestamp, so concurrent
  // read/status transitions within the same millisecond cannot invalidate the audit.
  for (const [index, field] of [...new Set([...target.fields, "updatedAt", "version"])].entries()) {
    const alias = `#snapshot${index}`;
    names[alias] = field;
    const value = snapshot[field];
    if (value) {
      const token = `:snapshot${index}`;
      values[token] = value;
      conditions.push(`${alias} = ${token}`);
    } else conditions.push(`attribute_not_exists(${alias})`);
  }
  const condition = { ConditionExpression: conditions.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
  await rawDb.send(new UpdateItemCommand({ TableName: tableName, Key: key, ...condition,
    UpdateExpression: "SET auditDeleteOutbox = :marker", ExpressionAttributeValues: { ...values, ":marker": { BOOL: true } } }));
  await rawDb.send(new TransactWriteItemsCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: key, ...condition } }, deletionAuditPut(tableName, snapshot)
  ] }));
  return true;
}
