import crypto from "node:crypto";
import { ConditionalCheckFailedException, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

export type EmailDeliveryStatus = "pending" | "accepted" | "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed" | "failed";
type EmailType = "inventory_daily_report" | "order_confirmation" | "payment_failure" | "order_failure" | "sale_campaign";

export type EmailDeliveryMeta = {
  PK: string; SK: "META"; entityType: "EMAIL"; id: string; emailType: EmailType;
  senderEmail: string; subject: string; recipientCount: number; reportId?: string; relatedId?: string;
  createdAt: string; updatedAt: string;
};

// Source of truth for one mailbox recipient. A parent META groups an operator action/campaign.
export type EmailDeliveryRecord = {
  PK: string; SK: `RECIPIENT#${string}`; entityType: "EMAIL_RECIPIENT";
  id: string; emailId: string; recipientId: string; emailType: EmailType;
  recipientEmail: string; recipientType: "to" | "cc" | "bcc"; senderEmail: string; subject: string;
  status: EmailDeliveryStatus; reportId?: string; relatedId?: string; sesMessageId?: string;
  failureReason?: string; providerEventType?: string; providerEventAt?: string;
  createdAt: string; updatedAt: string; acceptedAt?: string; deliveredAt?: string;
  bouncedAt?: string; complainedAt?: string;
};

function metaKey(emailId: string) { return { PK: `EMAIL#${emailId}`, SK: "META" } as const; }
function recipientKey(emailId: string, recipientId: string) { return { PK: `EMAIL#${emailId}`, SK: `RECIPIENT#${recipientId}` } as const; }
function item(value: Record<string, unknown>) { return marshall(value, { removeUndefinedValues: true }); }
function isConditionalFailure(error: unknown) {
  return error instanceof ConditionalCheckFailedException || (error as { name?: string } | undefined)?.name === "ConditionalCheckFailedException";
}

// SES copies these values into Delivery/Bounce/Complaint events. They are the
// correlation keys used by the event consumer; never put customer data in tags.
export function sesTrackingTags(input: { emailId: string; recipientId: string; emailType: EmailType }) {
  return [
    { Name: "emailId", Value: input.emailId },
    { Name: "recipientId", Value: input.recipientId },
    { Name: "emailType", Value: input.emailType }
  ];
}

export async function createPendingEmailDeliveryBatch(input: {
  emailType: EmailType; senderEmail: string; subject: string;
  recipients: Array<{ email: string; type?: "to" | "cc" | "bcc" }>;
  reportId?: string; relatedId?: string; emailId?: string;
}) {
  if (input.recipients.length === 0 || input.recipients.length > 99) throw new Error("An email batch must contain from 1 to 99 recipients.");
  const normalized = input.recipients.map((recipient) => ({ email: recipient.email.trim().toLowerCase(), type: recipient.type ?? "to" }));
  if (normalized.some((recipient) => !recipient.email)) throw new Error("Recipient email is required.");
  if (new Set(normalized.map((recipient) => recipient.email)).size !== normalized.length) throw new Error("A recipient may appear only once in an email batch.");

  const now = new Date().toISOString();
  const emailId = input.emailId ?? crypto.randomUUID();
  const meta: EmailDeliveryMeta = {
    ...metaKey(emailId), entityType: "EMAIL", id: emailId, emailType: input.emailType,
    senderEmail: input.senderEmail, subject: input.subject, recipientCount: normalized.length,
    reportId: input.reportId, relatedId: input.relatedId, createdAt: now, updatedAt: now
  };
  const recipients: EmailDeliveryRecord[] = normalized.map((recipient) => {
    const recipientId = crypto.randomUUID();
    return {
      ...recipientKey(emailId, recipientId), entityType: "EMAIL_RECIPIENT", id: recipientId, emailId, recipientId,
      emailType: input.emailType, recipientEmail: recipient.email, recipientType: recipient.type,
      senderEmail: input.senderEmail, subject: input.subject, status: "pending", reportId: input.reportId,
      relatedId: input.relatedId, createdAt: now, updatedAt: now
    };
  });
  await rawDb.send(new TransactWriteItemsCommand({
    TransactItems: [meta, ...recipients].map((record) => ({ Put: {
      TableName, Item: item(record), ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    } }))
  }));
  return { meta, recipients };
}

// Existing transactional email callers keep their API. Its emailId and recipientId are deliberately equal.
export async function createPendingEmailDelivery(input: {
  emailType: EmailType; recipientEmail: string; senderEmail: string; subject: string; reportId?: string; relatedId?: string;
}) {
  const emailId = crypto.randomUUID();
  const now = new Date().toISOString();
  const meta: EmailDeliveryMeta = {
    ...metaKey(emailId), entityType: "EMAIL", id: emailId, emailType: input.emailType, senderEmail: input.senderEmail,
    subject: input.subject, recipientCount: 1, reportId: input.reportId, relatedId: input.relatedId, createdAt: now, updatedAt: now
  };
  const record: EmailDeliveryRecord = {
    ...recipientKey(emailId, emailId), entityType: "EMAIL_RECIPIENT", id: emailId, emailId, recipientId: emailId,
    emailType: input.emailType, recipientEmail: input.recipientEmail.trim().toLowerCase(), recipientType: "to",
    senderEmail: input.senderEmail, subject: input.subject, status: "pending", reportId: input.reportId,
    relatedId: input.relatedId, createdAt: now, updatedAt: now
  };
  await rawDb.send(new TransactWriteItemsCommand({ TransactItems: [meta, record].map((value) => ({ Put: {
    TableName, Item: item(value), ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  } })) }));
  return record;
}

export async function markEmailRecipientAccepted(input: { emailId: string; recipientId: string; sesMessageId: string }) {
  const now = new Date().toISOString();
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName, Key: item(recipientKey(input.emailId, input.recipientId)),
      ConditionExpression: "attribute_exists(PK) AND #status IN (:pending, :accepted)",
      UpdateExpression: "SET #status = :accepted, sesMessageId = :sesMessageId, acceptedAt = :acceptedAt, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: item({ ":pending": "pending", ":accepted": "accepted", ":sesMessageId": input.sesMessageId, ":acceptedAt": now, ":updatedAt": now })
    }));
    return true;
  } catch (error) { if (isConditionalFailure(error)) return false; throw error; }
}

export async function markEmailDeliveryAccepted(id: string, sesMessageId: string) {
  return markEmailRecipientAccepted({ emailId: id, recipientId: id, sesMessageId });
}

export async function markEmailDeliveryFailed(id: string, failureReason: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName, Key: item(recipientKey(id, id)), ConditionExpression: "attribute_exists(PK)",
    UpdateExpression: "SET #status = :failed, failureReason = :failureReason, updatedAt = :updatedAt",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: item({ ":failed": "failed", ":failureReason": failureReason.slice(0, 500), ":updatedAt": now })
  }));
}

export async function updateEmailRecipientStatus(input: {
  emailId: string; recipientId: string; sesMessageId?: string;
  status: Extract<EmailDeliveryStatus, "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed">;
  providerEventType: string; providerEventAt?: string;
}) {
  const now = new Date().toISOString();
  const occurredAt = input.providerEventAt ?? now;
  const statusTimestamp = input.status === "delivered" ? ", deliveredAt = :occurredAt"
    : input.status === "bounced" ? ", bouncedAt = :occurredAt"
      : input.status === "complained" ? ", complainedAt = :occurredAt" : "";
  const values: Record<string, unknown> = {
    ":status": input.status, ":providerEventType": input.providerEventType, ":providerEventAt": occurredAt,
    ":updatedAt": now, ":occurredAt": occurredAt, ":pending": "pending", ":accepted": "accepted", ":deliveryDelayed": "delivery_delayed"
  };
  if (input.sesMessageId) values[":sesMessageId"] = input.sesMessageId;
  try {
    await rawDb.send(new UpdateItemCommand({
      TableName, Key: item(recipientKey(input.emailId, input.recipientId)),
      // A late DeliveryDelay cannot replace a final outcome. A complaint after Delivery is valid.
      ConditionExpression: input.status === "delivery_delayed"
        ? "attribute_exists(PK) AND #status IN (:pending, :accepted, :deliveryDelayed)"
        : input.status === "delivered"
          ? "attribute_exists(PK) AND #status IN (:pending, :accepted, :deliveryDelayed, :status)"
          : input.status === "complained"
            // Complaint can legitimately arrive after Delivery, but the same event is a no-op.
            ? "attribute_exists(PK) AND #status <> :status"
            // A late Bounce/Reject must not overwrite a prior final Delivery/Complaint.
            : "attribute_exists(PK) AND #status IN (:pending, :accepted, :deliveryDelayed, :status)",
      UpdateExpression: `SET #status = :status, providerEventType = :providerEventType, providerEventAt = :providerEventAt, updatedAt = :updatedAt${input.sesMessageId ? ", sesMessageId = if_not_exists(sesMessageId, :sesMessageId)" : ""}${statusTimestamp}`,
      ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: item(values)
    }));
    return true;
  } catch (error) { if (isConditionalFailure(error)) return false; throw error; }
}

// Legacy single-recipient tags have only emailId, so it doubles as recipientId.
export async function updateEmailDeliveryStatus(input: Omit<Parameters<typeof updateEmailRecipientStatus>[0], "emailId" | "recipientId"> & { id: string }) {
  return updateEmailRecipientStatus({ ...input, emailId: input.id, recipientId: input.id });
}
