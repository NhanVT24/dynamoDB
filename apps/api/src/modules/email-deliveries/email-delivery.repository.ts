import crypto from "node:crypto";
import {
  ConditionalCheckFailedException,
  PutItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

export type EmailDeliveryStatus =
  | "pending"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "rejected"
  | "delivery_delayed"
  | "failed";

export type EmailDeliveryRecord = {
  PK: string;
  SK: "DETAIL";
  entityType: "EMAIL";
  id: string;
  emailType: "inventory_daily_report" | "order_confirmation" | "payment_failure" | "order_failure";
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  status: EmailDeliveryStatus;
  reportId?: string;
  relatedId?: string;
  sesMessageId?: string;
  failureReason?: string;
  providerEventType?: string;
  providerEventAt?: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  deliveredAt?: string;
  bouncedAt?: string;
  complainedAt?: string;
};

function emailKey(id: string) {
  return { PK: `EMAIL#${id}`, SK: "DETAIL" } as const;
}

function item(value: Record<string, unknown>) {
  return marshall(value, { removeUndefinedValues: true });
}

function isConditionalFailure(error: unknown) {
  return error instanceof ConditionalCheckFailedException
    || (error as { name?: string } | undefined)?.name === "ConditionalCheckFailedException";
}

export async function createPendingEmailDelivery(input: {
  emailType: EmailDeliveryRecord["emailType"];
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  reportId?: string;
  relatedId?: string;
}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record: EmailDeliveryRecord = {
    ...emailKey(id),
    entityType: "EMAIL",
    id,
    emailType: input.emailType,
    recipientEmail: input.recipientEmail,
    senderEmail: input.senderEmail,
    subject: input.subject,
    status: "pending",
    reportId: input.reportId,
    relatedId: input.relatedId,
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: item(record),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return record;
}

export async function markEmailDeliveryAccepted(id: string, sesMessageId: string) {
  const now = new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName,
      Key: item(emailKey(id)),
      // An SES feedback event can arrive before this update. Never regress a terminal status to accepted.
      ConditionExpression: "attribute_exists(PK) AND #status IN (:pending, :accepted)",
      UpdateExpression: "SET #status = :accepted, sesMessageId = :sesMessageId, acceptedAt = :acceptedAt, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({
        ":pending": "pending",
        ":accepted": "accepted",
        ":sesMessageId": sesMessageId,
        ":acceptedAt": now,
        ":updatedAt": now
      })
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function markEmailDeliveryFailed(id: string, failureReason: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: item(emailKey(id)),
    ConditionExpression: "attribute_exists(PK)",
    UpdateExpression: "SET #status = :failed, failureReason = :failureReason, updatedAt = :updatedAt",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: item({
      ":failed": "failed",
      ":failureReason": failureReason.slice(0, 500),
      ":updatedAt": now
    })
  }));
}

export async function updateEmailDeliveryStatus(input: {
  id: string;
  sesMessageId?: string;
  status: Extract<EmailDeliveryStatus, "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed">;
  providerEventType: string;
  providerEventAt?: string;
}) {
  const now = new Date().toISOString();
  const occurredAt = input.providerEventAt ?? now;
  const statusTimestamp = input.status === "delivered"
    ? ", deliveredAt = :occurredAt"
    : input.status === "bounced"
      ? ", bouncedAt = :occurredAt"
      : input.status === "complained"
        ? ", complainedAt = :occurredAt"
      : "";
  const values: Record<string, unknown> = {
    ":status": input.status,
    ":sesMessageId": input.sesMessageId ?? "",
    ":providerEventType": input.providerEventType,
    ":providerEventAt": occurredAt,
    ":updatedAt": now
  };
  if (input.status === "delivered" || input.status === "bounced" || input.status === "complained") {
    values[":occurredAt"] = occurredAt;
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
      Key: item(emailKey(input.id)),
      // SES feedback is asynchronous and can be observed out of order. A late
      // Delivery must never downgrade a prior Bounce/Complaint/Reject result.
      ConditionExpression: preventDeliveryRegression
        ? "attribute_exists(PK) AND #status IN (:pending, :accepted, :delivered, :deliveryDelayed)"
        : "attribute_exists(PK)",
      UpdateExpression: `SET #status = :status, sesMessageId = if_not_exists(sesMessageId, :sesMessageId), providerEventType = :providerEventType, providerEventAt = :providerEventAt, updatedAt = :updatedAt${statusTimestamp}`,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item(values)
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}
