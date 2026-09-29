import { z } from "zod";

type StringAttribute = { S?: string };
type AttributeImage = Record<string, StringAttribute>;

const auditWriter = "lambda:supermarket-audit-log-stream";

export type AuditStreamRecord = {
  eventID?: string;
  eventName?: string;
  eventSourceARN?: string;
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
  resourceType: "ORDER" | "PAYMENT";
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
  USER: ["email", "displayName", "role", "status", "permissions"] as const,
  PRODUCT: ["name", "price", "stock", "status", "categoryId"] as const
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
  resourceType: z.enum(["ORDER", "PAYMENT"]),
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

// Accept old queue messages while the queue drains during migration.
const legacyAuditLogSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("AUDIT_LOG_ORDER"),
  orderId: z.string().min(1),
  changeType: z.enum(["ORDER_STATUS", "PAYMENT_STATUS"]),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  before: z.string().nullable().optional(),
  after: z.string().nullable().optional(),
  previousStatus: z.string().optional(),
  status: z.string().optional(),
  actor: actorSchema.optional(),
  context: contextSchema.optional(),
  occurredAt: z.iso.datetime(),
  sourceSK: z.enum(["ORDER", "DETAIL"]),
  sourceEventId: z.string().min(1),
  sourceSequenceNumber: z.string().min(1),
  sourcePK: z.string().optional(),
  changes: z.object({
    orderStatus: changeSchema.optional(),
    paymentStatus: changeSchema.optional()
  }).strict().optional(),
  paymentTxnRef: z.string().min(1).optional()
}).strict();

function defaultAuditActor(): AuditActor {
  return { type: "SERVICE", id: "unknown", role: "SYSTEM" };
}

function defaultAuditContext(): AuditContext {
  return { source: "UNKNOWN", auditWriter };
}

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

function legacyPaymentOrderId(orderInfo: string | undefined): string | undefined {
  return orderInfo?.match(/^(?:Payment for order|Thanh toán đơn hàng)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
}

function actionFromEventName(eventName: AuditLogRecord["eventName"]): AuditLogRecord["action"] {
  if (eventName === "INSERT") return "CREATED";
  if (eventName === "REMOVE") return "DELETED";
  return "UPDATED";
}

function buildChanges(
  oldImage: AttributeImage | undefined,
  newImage: AttributeImage | undefined,
  fields: readonly string[]
): Record<string, AuditChange> {
  return Object.fromEntries(fields.flatMap((field) => {
    const before = oldImage?.[field]?.S ?? null;
    const after = newImage?.[field]?.S ?? null;
    if (before === after) return [];
    return [[field, { before, after }]];
  }));
}

function assertAuditIdentity(audit: AuditLogRecord) {
  const changeKeys = Object.keys(audit.changes);
  if (audit.PK !== `AUDIT_LOG#${audit.resourceType}#${audit.resourceId}`
    || audit.SK !== `EVENT#${audit.occurredAt}#${audit.source.eventId}`
    || changeKeys.length === 0
    || changeKeys.some((field) => audit.changes[field]?.before === audit.changes[field]?.after)
    || (audit.resourceType === "PAYMENT" && (!audit.parentResourceId || !audit.paymentTxnRef))) {
    throw new Error("Audit log message has invalid identity or changes.");
  }
}

export function parseAuditLogMessage(body: string | undefined): AuditLogRecord {
  if (!body) throw new Error("Audit log queue message is empty.");
  const payload: unknown = JSON.parse(body);
  if (typeof payload !== "object" || payload === null) throw new Error("Audit log queue message must be an object.");

  if ("resourceType" in payload && "changes" in payload) {
    const audit = auditLogSchema.parse(payload) as AuditLogRecord;
    assertAuditIdentity(audit);
    return audit;
  }

  const legacy = legacyAuditLogSchema.parse(payload);
  const resourceType = legacy.changeType === "PAYMENT_STATUS" ? "PAYMENT" : "ORDER";
  const resourceId = legacy.paymentTxnRef ?? legacy.orderId;
  const legacyChange = resourceType === "PAYMENT" ? legacy.changes?.paymentStatus : legacy.changes?.orderStatus;
  const before = legacy.before ?? legacy.previousStatus ?? legacyChange?.before ?? null;
  const after = legacy.after ?? legacy.status ?? legacyChange?.after ?? null;
  const audit: AuditLogRecord = {
    PK: `AUDIT_LOG#${resourceType}#${resourceId}`,
    SK: `EVENT#${legacy.occurredAt}#${legacy.sourceEventId}`,
    entityType: "AUDIT_LOG",
    resourceType,
    resourceId,
    ...(resourceType === "PAYMENT" ? { parentResourceType: "ORDER", parentResourceId: legacy.orderId } : {}),
    action: actionFromEventName(legacy.eventName),
    eventName: legacy.eventName,
    changes: { status: { before, after } },
    actor: legacy.actor ?? defaultAuditActor(),
    context: legacy.context ?? defaultAuditContext(),
    occurredAt: legacy.occurredAt,
    source: {
      type: "DYNAMODB_STREAM",
      pk: resourceType === "PAYMENT" ? `PAYMENT#${resourceId}` : `ORDER#${legacy.orderId}`,
      sk: legacy.sourceSK,
      eventId: legacy.sourceEventId,
      sequenceNumber: legacy.sourceSequenceNumber
    },
    ...(legacy.paymentTxnRef ? { paymentTxnRef: legacy.paymentTxnRef } : {})
  };
  assertAuditIdentity(audit);
  return audit;
}

export function buildAuditLogRecord(record: AuditStreamRecord): AuditLogRecord | null {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.PK?.S ?? "";
  const sk = keys?.SK?.S ?? "";
  const isOrder = pk.startsWith("ORDER#") && (sk === "ORDER" || sk === "DETAIL");
  const isPayment = pk.startsWith("PAYMENT#") && sk === "DETAIL";
  if (!isOrder && !isPayment) return null;

  const eventName = record.eventName;
  if (eventName !== "INSERT" && eventName !== "MODIFY" && eventName !== "REMOVE") return null;
  if (!record.eventID || !record.dynamodb?.SequenceNumber) throw new Error("Audit stream record is missing its event identity.");

  const oldImage = record.dynamodb.OldImage;
  const newImage = record.dynamodb.NewImage;
  if (isPayment && (newImage?.entityType?.S ?? oldImage?.entityType?.S) !== "PAYMENT_SESSION") return null;

  const orderId = isOrder ? pk.slice("ORDER#".length)
    : newImage?.orderId?.S ?? oldImage?.orderId?.S
      ?? legacyPaymentOrderId(newImage?.orderInfo?.S ?? oldImage?.orderInfo?.S);
  if (!orderId && isPayment) return null;
  if (!orderId) throw new Error("Order stream record has an empty order ID.");

  const resourceType = isPayment ? "PAYMENT" : "ORDER";
  const resourceId = isPayment ? pk.slice("PAYMENT#".length) : orderId;
  if (isPayment && (!resourceId || (newImage?.txnRef?.S ?? oldImage?.txnRef?.S) !== resourceId)) {
    throw new Error("Payment stream record has an invalid transaction reference.");
  }

  const changes = buildChanges(
    oldImage,
    newImage,
    resourceType === "PAYMENT" ? auditFieldWhitelist.PAYMENT : auditFieldWhitelist.ORDER
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
    action: actionFromEventName(eventName),
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
