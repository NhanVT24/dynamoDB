import crypto from "node:crypto";
import { BatchWriteItemCommand, DeleteItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand, type AttributeValue, type WriteRequest } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? (unmarshall(item) as Record<string, any>) : null;
}

export type NotificationRecord = {
  PK: string;
  SK: string;
  entityType: "NOTIFICATION";
  id: string;
  customerEmail: string;
  title: string;
  message: string;
  channel: "email" | "system";
  status: "pending" | "sent" | "read";
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function createNotification(input: {
  email: string;
  title: string;
  message: string;
  channel: "email" | "system";
  status?: "pending" | "sent" | "read";
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record: NotificationRecord = {
    PK: `NOTIFICATION#${id}`,
    SK: "DETAIL",
    entityType: "NOTIFICATION",
    id,
    customerEmail: input.email,
    title: input.title,
    message: input.message,
    channel: input.channel,
    status: input.status ?? "pending",
    isRead: input.status === "read",
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem(record),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return record;
}

export async function listNotificationsByCustomer(email: string) {
  const result = await rawDb.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :entityType AND customerEmail = :customerEmail",
    ExpressionAttributeValues: toDynamoItem({
      ":entityType": "NOTIFICATION",
      ":customerEmail": email
    })
  }));

  return (result.Items ?? [])
    .map((item) => fromDynamoItem(item) as NotificationRecord | null)
    .map((item) => item ? { ...item, isRead: Boolean(item.isRead ?? item.status === "read") } : item)
    .filter(Boolean)
    .sort((left, right) => String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")));
}

export async function listAllNotifications() {
  const result = await rawDb.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :entityType",
    ExpressionAttributeValues: toDynamoItem({
      ":entityType": "NOTIFICATION"
    })
  }));

  return (result.Items ?? [])
    .map((item) => fromDynamoItem(item) as NotificationRecord | null)
    .map((item) => item ? { ...item, isRead: Boolean(item.isRead ?? item.status === "read") } : item)
    .filter(Boolean)
    .sort((left, right) => String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")));
}

export async function markNotificationAsRead(id: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `NOTIFICATION#${id}`,
      SK: "DETAIL"
    }),
    UpdateExpression: "SET #status = :status, isRead = :isRead, updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":status": "read",
      ":isRead": true,
      ":updatedAt": now
    })
  }));
}

export async function markNotificationAsSent(id: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `NOTIFICATION#${id}`,
      SK: "DETAIL"
    }),
    UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":status": "sent",
      ":updatedAt": now
    })
  }));
}

export async function deleteNotification(id: string) {
  await rawDb.send(new DeleteItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `NOTIFICATION#${id}`,
      SK: "DETAIL"
    }),
    ConditionExpression: "attribute_exists(PK)"
  }));
}

export async function deleteNotifications(ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  for (let index = 0; index < ids.length; index += 25) {
    const batch = ids.slice(index, index + 25);
    const requests: WriteRequest[] = batch.map((id) => ({
      DeleteRequest: {
        Key: toDynamoItem({
          PK: `NOTIFICATION#${id}`,
          SK: "DETAIL"
        })
      }
    }));

    await rawDb.send(new BatchWriteItemCommand({
      RequestItems: {
        [TableName]: requests
      }
    }));
  }
}
