import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

export type InventoryReportStatus =
  | "pending"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "rejected"
  | "delivery_delayed"
  | "failed";

export type InventoryReportRecord = {
  PK: string;
  SK: "DETAIL";
  entityType: "INVENTORY_DAILY_REPORT";
  reportId: string;
  reportDate: string;
  status: InventoryReportStatus;
  recipientEmail: string;
  lowStockCount: number;
  outOfStockCount: number;
  productCount: number;
  sesMessageId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  deliveredAt?: string;
  complainedAt?: string;
};

function reportKey(reportId: string) {
  return {
    PK: `INVENTORY_REPORT#${reportId}`,
    SK: "DETAIL"
  } as const;
}

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? unmarshall(item) as InventoryReportRecord : null;
}

export async function createPendingInventoryReport(input: {
  reportId: string;
  reportDate: string;
  recipientEmail: string;
  lowStockCount: number;
  outOfStockCount: number;
}) {
  const now = new Date().toISOString();
  const record: InventoryReportRecord = {
    ...reportKey(input.reportId),
    entityType: "INVENTORY_DAILY_REPORT",
    reportId: input.reportId,
    reportDate: input.reportDate,
    status: "pending",
    recipientEmail: input.recipientEmail,
    lowStockCount: input.lowStockCount,
    outOfStockCount: input.outOfStockCount,
    productCount: input.lowStockCount + input.outOfStockCount,
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem(record),
    // One report key per local date makes duplicate Scheduler invocations harmless.
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return record;
}

export async function getInventoryReport(reportId: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(reportKey(reportId)),
    ConsistentRead: true
  }));

  return fromDynamoItem(result.Item);
}

export async function markInventoryReportAccepted(reportId: string, sesMessageId: string) {
  const now = new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: toDynamoItem(reportKey(reportId)),
      // Feedback can arrive before SendEmail returns. Do not overwrite a terminal result.
      UpdateExpression: "SET #status = :status, sesMessageId = :sesMessageId, acceptedAt = :acceptedAt, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND #status IN (:pending, :accepted)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: toDynamoItem({
        ":status": "accepted",
        ":pending": "pending",
        ":accepted": "accepted",
        ":sesMessageId": sesMessageId,
        ":acceptedAt": now,
        ":updatedAt": now
      })
    }));
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || (error as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}

export async function markInventoryReportFailed(reportId: string, failureReason: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(reportKey(reportId)),
    UpdateExpression: "SET #status = :status, failureReason = :failureReason, updatedAt = :updatedAt",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: toDynamoItem({
      ":status": "failed",
      ":failureReason": failureReason.slice(0, 500),
      ":updatedAt": now
    })
  }));
}

export async function updateInventoryReportDeliveryStatus(input: {
  reportId: string;
  sesMessageId?: string;
  status: Extract<InventoryReportStatus, "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed">;
}) {
  const now = new Date().toISOString();
  const timestampField = input.status === "delivered"
    ? ", deliveredAt = :eventAt"
    : input.status === "complained"
      ? ", complainedAt = :eventAt"
      : "";
  const values: Record<string, unknown> = {
    ":status": input.status,
    ":sesMessageId": input.sesMessageId ?? "",
    ":updatedAt": now
  };
  if (input.status === "delivered" || input.status === "complained") {
    values[":eventAt"] = now;
  }
  const preventDeliveryRegression = input.status === "delivered";
  if (preventDeliveryRegression) {
    values[":pending"] = "pending";
    values[":accepted"] = "accepted";
    values[":delivered"] = "delivered";
    values[":deliveryDelayed"] = "delivery_delayed";
  }
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: toDynamoItem(reportKey(input.reportId)),
      // SNS feedback can arrive out of order. Do not regress a final outcome.
      UpdateExpression: `SET #status = :status, sesMessageId = if_not_exists(sesMessageId, :sesMessageId), updatedAt = :updatedAt${timestampField}`,
      ConditionExpression: preventDeliveryRegression
        ? "attribute_exists(PK) AND #status IN (:pending, :accepted, :delivered, :deliveryDelayed)"
        : "attribute_exists(PK)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: toDynamoItem(values)
    }));
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || (error as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}
