import { z } from "zod";

type StringAttribute = { S?: string; SS?: string[] };
type AttributeImage = Record<string, StringAttribute>;

const auditWriter = "lambda:supermarket-audit-log-stream";

export type AuditStreamRecord = {
  eventID?: string;
  eventName?: string;
  dynamodb?: {
    Keys?: AttributeImage;
    NewImage?: AttributeImage;
    OldImage?: AttributeImage;
    SequenceNumber?: string;
    ApproximateCreationDateTime?: number;
  };
};

export type AuditActor = {
  type: "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
  id: string;
  role?: string;
};

export type AuditContext = {
  source: string;
  reason?: string;
  requestId?: string;
  auditWriter: string;
};

export type AuditChange = {
  before: string | null;
  after: string | null;
};

export type AuditLogRecord = {
  PK: string;
  SK: string;
  entityType: "AUDIT_LOG";
  resourceType: "ORDER" | "PAYMENT" | "USER";
  resourceId: string;
  parentResourceType?: "ORDER";
  parentResourceId?: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  changes: Record<string, AuditChange>;
  actor: AuditActor;
  context: AuditContext;
  occurredAt: string;
  source: {
    type: "DYNAMODB_STREAM";
    pk: string;
    sk: string;
    eventId: string;
    sequenceNumber: string;
  };
  paymentTxnRef?: string;
};

export const auditFieldWhitelist = {
  ORDER: ["status"] as const,
  PAYMENT: ["status"] as const,
  USER: {
    PROFILE: ["displayName", "avatarKey", "status"] as const,
    AUTHORIZATION: ["permissions"] as const
  }
};

export const auditFieldDenylist = [
  "password",
  "passwordHash",
  "refreshToken",
  "accessToken",
  "idToken",
  "otpSecret",
  "secret",
  "hash",
  "customerEmail",
  "email",
  "phone",
  "address"
] as const;

const actorSchema = z.object({
  type: z.enum(["USER", "ADMIN", "SERVICE", "SYSTEM"]),
  id: z.string().min(1),
  role: z.string().min(1).optional()
}).strict();

const contextSchema = z.object({
  source: z.string().min(1),
  reason: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  auditWriter: z.string().min(1)
}).strict();

const changeSchema = z.object({
  before: z.string().nullable(),
  after: z.string().nullable()
}).strict();

const auditLogSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("AUDIT_LOG"),
  resourceType: z.enum(["ORDER", "PAYMENT", "USER"]),
  resourceId: z.string().min(1),
  parentResourceType: z.literal("ORDER").optional(),
  parentResourceId: z.string().min(1).optional(),
  action: z.enum(["CREATED", "UPDATED", "DELETED"]),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  changes: z.record(z.string().min(1), changeSchema),
  actor: actorSchema,
  context: contextSchema,
  occurredAt: z.iso.datetime(),
  source: z.object({
    type: z.literal("DYNAMODB_STREAM"),
    pk: z.string().min(1),
    sk: z.string().min(1),
    eventId: z.string().min(1),
    sequenceNumber: z.string().min(1)
  }).strict(),
  paymentTxnRef: z.string().min(1).optional()
}).strict();

function imageString(image: AttributeImage | undefined, key: string): string | undefined {
  const value = image?.[key]?.S?.trim();
  return value || undefined;
}

function buildActorFromImage(
  newImage: AttributeImage | undefined,
  oldImage: AttributeImage | undefined
): { actor: AuditActor; context: AuditContext } {
  const actorType = imageString(newImage, "auditActorType") ?? imageString(oldImage, "auditActorType");
  const actorId = imageString(newImage, "auditActorId") ?? imageString(oldImage, "auditActorId");
  const actorRole = imageString(newImage, "auditActorRole") ?? imageString(oldImage, "auditActorRole");
  const source = imageString(newImage, "auditSource") ?? imageString(oldImage, "auditSource");
  const reason = imageString(newImage, "auditReason") ?? imageString(oldImage, "auditReason");
  const requestId = imageString(newImage, "auditRequestId") ?? imageString(oldImage, "auditRequestId");
  const safeActorType = actorType === "USER" || actorType === "ADMIN" || actorType === "SERVICE" || actorType === "SYSTEM"
    ? actorType
    : "SERVICE";

  return {
    actor: {
      type: safeActorType,
      id: actorId ?? "unknown",
      ...(actorRole ? { role: actorRole } : { role: safeActorType === "SERVICE" ? "SYSTEM" : undefined })
    },
    context: {
      source: source ?? "UNKNOWN",
      ...(reason ? { reason } : {}),
      ...(requestId ? { requestId } : {}),
      auditWriter
    }
  };
}

function buildChanges(
  oldImage: AttributeImage | undefined,
  newImage: AttributeImage | undefined,
  fields: readonly string[]
): Record<string, AuditChange> {
  return Object.fromEntries(fields.flatMap((field) => {
    const before = auditAttributeValue(oldImage?.[field]);
    const after = auditAttributeValue(newImage?.[field]);
    if (before === after) return [];
    return [[field, { before, after }]];
  }));
}

function auditAttributeValue(attribute: StringAttribute | undefined): string | null {
  if (attribute?.S !== undefined) return attribute.S;
  if (attribute?.SS) return JSON.stringify([...attribute.SS].sort());
  return null;
}

function assertAuditIdentity(audit: AuditLogRecord) {
  const changeKeys = Object.keys(audit.changes);
  const allowedFields: readonly string[] = audit.resourceType === "USER"
    ? audit.source.sk === "PROFILE" ? auditFieldWhitelist.USER.PROFILE
      : audit.source.sk === "AUTHORIZATION" ? auditFieldWhitelist.USER.AUTHORIZATION : []
    : auditFieldWhitelist[audit.resourceType];
  if (audit.PK !== `AUDIT_LOG#${audit.resourceType}#${audit.resourceId}`
    || audit.SK !== `EVENT#${audit.occurredAt}#${audit.source.eventId}`
    || changeKeys.length === 0
    || changeKeys.some((field) => !allowedFields.includes(field) || (auditFieldDenylist as readonly string[]).includes(field))
    || changeKeys.some((field) => audit.changes[field]?.before === audit.changes[field]?.after)
    || (audit.resourceType === "PAYMENT" && (!audit.parentResourceId || !audit.paymentTxnRef))) {
    throw new Error("Audit log message has invalid identity or changes.");
  }
}

export function parseAuditLogMessage(body: string | undefined): AuditLogRecord {
  if (!body) throw new Error("Audit log queue message is empty.");
  const audit = auditLogSchema.parse(JSON.parse(body)) as AuditLogRecord;
  assertAuditIdentity(audit);
  return audit;
}

export function buildAuditLogRecord(record: AuditStreamRecord): AuditLogRecord | null {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.PK?.S ?? "";
  const sk = keys?.SK?.S ?? "";
  const isOrder = pk.startsWith("ORDER#") && (sk === "ORDER" || sk === "DETAIL");
  const isPayment = pk.startsWith("PAYMENT#") && sk === "DETAIL";
  const isUser = pk.startsWith("USER#") && (sk === "PROFILE" || sk === "AUTHORIZATION");
  if (!isOrder && !isPayment && !isUser) return null;

  const eventName = record.eventName;
  if (eventName !== "INSERT" && eventName !== "MODIFY" && eventName !== "REMOVE") return null;
  if (!record.eventID || !record.dynamodb?.SequenceNumber) throw new Error("Audit stream record is missing its event identity.");

  const oldImage = record.dynamodb.OldImage;
  const newImage = record.dynamodb.NewImage;
  if (isPayment && (newImage?.entityType?.S ?? oldImage?.entityType?.S) !== "PAYMENT_SESSION") return null;
  if (isUser && (newImage?.entityType?.S ?? oldImage?.entityType?.S) !== (sk === "PROFILE" ? "USER_PROFILE" : "USER_AUTHORIZATION")) return null;

  const orderId = isOrder ? pk.slice("ORDER#".length)
    : isPayment ? newImage?.orderId?.S ?? oldImage?.orderId?.S : undefined;
  if (!orderId && isPayment) return null;
  if (!orderId && isOrder) throw new Error("Order stream record has an empty order ID.");

  const resourceType = isPayment ? "PAYMENT" : isUser ? "USER" : "ORDER";
  const resourceId = isPayment ? pk.slice("PAYMENT#".length) : isUser ? pk.slice("USER#".length) : orderId;
  if (!resourceId) throw new Error("Audit stream record has an empty resource ID.");
  if (isPayment && (newImage?.txnRef?.S ?? oldImage?.txnRef?.S) !== resourceId) {
    throw new Error("Payment stream record has an invalid transaction reference.");
  }

  const changes = buildChanges(
    oldImage,
    newImage,
    resourceType === "PAYMENT" ? auditFieldWhitelist.PAYMENT
      : resourceType === "USER" ? (sk === "PROFILE" ? auditFieldWhitelist.USER.PROFILE : auditFieldWhitelist.USER.AUTHORIZATION)
        : auditFieldWhitelist.ORDER
  );
  if (Object.keys(changes).length === 0) return null;

  const eventTime = record.dynamodb.ApproximateCreationDateTime;
  if (typeof eventTime !== "number" || !Number.isFinite(eventTime)) {
    throw new Error("Audit stream record is missing its creation time.");
  }

  const occurredAt = new Date(eventTime * 1000).toISOString();
  const metadata = buildActorFromImage(newImage, oldImage);
  const audit: AuditLogRecord = {
    PK: `AUDIT_LOG#${resourceType}#${resourceId}`,
    SK: `EVENT#${occurredAt}#${record.eventID}`,
    entityType: "AUDIT_LOG",
    resourceType,
    resourceId,
    ...(resourceType === "PAYMENT" ? { parentResourceType: "ORDER", parentResourceId: orderId } : {}),
    action: eventName === "INSERT" ? "CREATED" : eventName === "REMOVE" ? "DELETED" : "UPDATED",
    eventName,
    changes,
    actor: metadata.actor,
    context: metadata.context,
    occurredAt,
    source: {
      type: "DYNAMODB_STREAM",
      pk,
      sk,
      eventId: record.eventID,
      sequenceNumber: record.dynamodb.SequenceNumber
    },
    ...(resourceType === "PAYMENT" ? { paymentTxnRef: resourceId } : {})
  };
  assertAuditIdentity(audit);
  return audit;
}
