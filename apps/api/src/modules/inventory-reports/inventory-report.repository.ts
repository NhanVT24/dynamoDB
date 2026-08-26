import {
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
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(reportKey(reportId)),
    UpdateExpression: "SET #status = :status, sesMessageId = :sesMessageId, acceptedAt = :acceptedAt, updatedAt = :updatedAt",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: toDynamoItem({
      ":status": "accepted",
      ":sesMessageId": sesMessageId,
      ":acceptedAt": now,
      ":updatedAt": now
    })
  }));
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
  status: Extract<InventoryReportStatus, "delivered" | "bounced" | "rejected" | "delivery_delayed">;
}) {
  const now = new Date().toISOString();
  const deliveryTimestampField = input.status === "delivered" ? ", deliveredAt = :deliveredAt" : "";
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(reportKey(input.reportId)),
    // SNS can deliver the same feedback more than once; assigning the same terminal state is idempotent.
    UpdateExpression: `SET #status = :status, sesMessageId = if_not_exists(sesMessageId, :sesMessageId), updatedAt = :updatedAt${deliveryTimestampField}`,
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: toDynamoItem({
      ":status": input.status,
      ":sesMessageId": input.sesMessageId ?? "",
      ":updatedAt": now,
      ":deliveredAt": now
    })
  }));
}
