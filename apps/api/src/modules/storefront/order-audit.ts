import { z } from "zod";

type StringAttribute = { S?: string };
const auditWriter = "lambda:supermarket-order-audit-stream";

export type OrderStreamRecord = {
  eventID?: string;
  eventName?: string;
  dynamodb?: {
    Keys?: Record<string, StringAttribute>;
    NewImage?: Record<string, StringAttribute>;
    OldImage?: Record<string, StringAttribute>;
    SequenceNumber?: string;
    ApproximateCreationDateTime?: number;
  };
};

export type OrderAuditActor = {
  type: "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
  id: string;
  role?: string;
};

export type OrderAuditContext = {
  source: string;
  reason?: string;
  requestId?: string;
  auditWriter: string;
};

export type OrderAuditRecord = {
  PK: string;
  SK: string;
  entityType: "AUDIT_LOG_ORDER";
  orderId: string;
  changeType: "ORDER_STATUS" | "PAYMENT_STATUS";
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  before: string | null;
  after: string | null;
  actor: OrderAuditActor;
  context: OrderAuditContext;
  occurredAt: string;
  sourceSK: "ORDER" | "DETAIL";
  sourceEventId: string;
  sourceSequenceNumber: string;
  paymentTxnRef?: string;
};

const auditKeySchema = {
  PK: z.string(),
  SK: z.string(),
  entityType: z.literal("AUDIT_LOG_ORDER"),
  orderId: z.string().min(1),
  occurredAt: z.iso.datetime()
};

const conciseAuditSchema = z.object({
  ...auditKeySchema,
  changeType: z.enum(["ORDER_STATUS", "PAYMENT_STATUS"]),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  before: z.string().nullable(),
  after: z.string().nullable(),
  actor: z.object({
    type: z.enum(["USER", "ADMIN", "SERVICE", "SYSTEM"]),
    id: z.string().min(1),
    role: z.string().min(1).optional()
  }).strict().optional(),
  context: z.object({
    source: z.string().min(1),
    reason: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    auditWriter: z.string().min(1)
  }).strict().optional(),
  sourceSK: z.enum(["ORDER", "DETAIL"]),
  sourceEventId: z.string().min(1),
  sourceSequenceNumber: z.string().min(1),
  paymentTxnRef: z.string().min(1).optional()
}).strict();

// Accept messages already in SQS when migrating from the older audit payload.
const legacyAuditSchema = z.object({
  ...auditKeySchema,
  sourceSK: z.enum(["ORDER", "DETAIL"]),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  previousStatus: z.string().optional(),
  status: z.string().optional(),
  sourceEventId: z.string().min(1),
  sourceSequenceNumber: z.string().min(1),
  changeType: z.enum(["ORDER_STATUS", "PAYMENT_STATUS"]).optional(),
  changes: z.object({
    orderStatus: z.object({ before: z.string().nullable(), after: z.string().nullable() }).strict().optional(),
    paymentStatus: z.object({ before: z.string().nullable(), after: z.string().nullable() }).strict().optional()
  }).strict().optional(),
  sourcePK: z.string().optional(),
  paymentTxnRef: z.string().optional()
}).strict();

function defaultAuditActor(): OrderAuditActor {
  return { type: "SERVICE", id: "unknown", role: "SYSTEM" };
}

function defaultAuditContext(): OrderAuditContext {
  return { source: "UNKNOWN", auditWriter };
}

function withAuditMetadata(audit: Omit<OrderAuditRecord, "actor" | "context"> & {
  actor?: OrderAuditActor;
  context?: OrderAuditContext;
}): OrderAuditRecord {
  return {
    ...audit,
    actor: audit.actor ?? defaultAuditActor(),
    context: audit.context ?? defaultAuditContext()
  };
}

function assertAuditIdentity(audit: OrderAuditRecord) {
  const eventPrefix = `EVENT#${audit.occurredAt}#`;
  if (audit.PK !== `AUDIT_LOG_ORDER#${audit.orderId}`
    || audit.SK !== `${eventPrefix}${audit.sourceEventId}`
    || (audit.before === null && audit.after === null)
    || audit.before === audit.after
    || (audit.eventName === "INSERT" && audit.before !== null)
    || (audit.eventName === "REMOVE" && audit.after !== null)
    || (audit.eventName === "MODIFY" && (!audit.before || !audit.after))
    || (audit.changeType === "PAYMENT_STATUS" && audit.sourceSK !== "DETAIL")
    || (audit.changeType === "PAYMENT_STATUS") !== Boolean(audit.paymentTxnRef)) {
    throw new Error("Order audit message has invalid identity or status change.");
  }
}

export function parseOrderAuditMessage(body: string | undefined): OrderAuditRecord {
  if (!body) throw new Error("Order audit queue message is empty.");
  const payload: unknown = JSON.parse(body);
  if (typeof payload !== "object" || payload === null) throw new Error("Order audit queue message must be an object.");

  if ("before" in payload || "after" in payload) {
    const audit = withAuditMetadata(conciseAuditSchema.parse(payload) as Omit<OrderAuditRecord, "actor" | "context"> & {
      actor?: OrderAuditActor;
      context?: OrderAuditContext;
    });
    assertAuditIdentity(audit);
    return audit;
  }

  const legacy = legacyAuditSchema.parse(payload);
  const before = legacy.previousStatus ?? null;
  const after = legacy.status ?? null;
  const changeType = legacy.changeType ?? "ORDER_STATUS";
  const oldChange = changeType === "PAYMENT_STATUS" ? legacy.changes?.paymentStatus : legacy.changes?.orderStatus;
  if (legacy.SK !== `EVENT#${legacy.occurredAt}#${legacy.sourceEventId}`
    || (legacy.eventName === "INSERT" && before !== null)
    || (legacy.eventName === "REMOVE" && after !== null)
    || (legacy.eventName === "MODIFY" && (!after || before === after))
    || (changeType === "PAYMENT_STATUS" && (legacy.sourceSK !== "DETAIL"
      || legacy.sourcePK !== `PAYMENT#${legacy.paymentTxnRef}`
      || !oldChange || legacy.changes?.orderStatus !== undefined))
    || (changeType === "ORDER_STATUS" && (legacy.sourcePK !== undefined
      && legacy.sourcePK !== `ORDER#${legacy.orderId}`))
    || (changeType === "ORDER_STATUS" && (legacy.paymentTxnRef !== undefined
      || legacy.changes?.paymentStatus !== undefined))
    || (oldChange && (oldChange.before !== before || oldChange.after !== after))) {
    throw new Error("Legacy order audit message has invalid identity or status change.");
  }

  const audit = withAuditMetadata({
    PK: legacy.PK,
    SK: legacy.SK,
    entityType: "AUDIT_LOG_ORDER",
    orderId: legacy.orderId,
    changeType,
    eventName: legacy.eventName,
    before,
    after,
    occurredAt: legacy.occurredAt,
    sourceSK: legacy.sourceSK,
    sourceEventId: legacy.sourceEventId,
    sourceSequenceNumber: legacy.sourceSequenceNumber,
    ...(legacy.paymentTxnRef ? { paymentTxnRef: legacy.paymentTxnRef } : {})
  });
  assertAuditIdentity(audit);
  return audit;
}

function legacyPaymentOrderId(orderInfo: string | undefined): string | undefined {
  return orderInfo?.match(/^(?:Payment for order|Thanh toán đơn hàng)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
}

function imageString(image: Record<string, StringAttribute> | undefined, key: string): string | undefined {
  const value = image?.[key]?.S?.trim();
  return value || undefined;
}

function buildActorFromImage(
  newImage: Record<string, StringAttribute> | undefined,
  oldImage: Record<string, StringAttribute> | undefined
): { actor: OrderAuditActor; context: OrderAuditContext } {
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

export function buildOrderAuditRecord(record: OrderStreamRecord): OrderAuditRecord | null {
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

  const before = oldImage?.status?.S ?? null;
  const after = newImage?.status?.S ?? null;
  if (eventName === "INSERT" && !after) throw new Error("Inserted item is missing status.");
  if (eventName === "MODIFY" && !after) throw new Error("Updated item is missing status.");
  if (eventName === "REMOVE" && !before) throw new Error("Removed item is missing previous status.");
  if (eventName === "MODIFY" && before === after) return null;

  const eventTime = record.dynamodb.ApproximateCreationDateTime;
  if (typeof eventTime !== "number" || !Number.isFinite(eventTime)) {
    throw new Error("Audit stream record is missing its creation time.");
  }
  const paymentTxnRef = isPayment ? pk.slice("PAYMENT#".length) : undefined;
  if (isPayment && (!paymentTxnRef || (newImage?.txnRef?.S ?? oldImage?.txnRef?.S) !== paymentTxnRef)) {
    throw new Error("Payment stream record has an invalid transaction reference.");
  }

  const occurredAt = new Date(eventTime * 1000).toISOString();
  const metadata = buildActorFromImage(newImage, oldImage);
  return {
    PK: `AUDIT_LOG_ORDER#${orderId}`,
    SK: `EVENT#${occurredAt}#${record.eventID}`,
    entityType: "AUDIT_LOG_ORDER",
    orderId,
    changeType: isPayment ? "PAYMENT_STATUS" : "ORDER_STATUS",
    eventName,
    before,
    after,
    actor: metadata.actor,
    context: metadata.context,
    occurredAt,
    sourceSK: sk === "ORDER" ? "ORDER" : "DETAIL",
    sourceEventId: record.eventID,
    sourceSequenceNumber: record.dynamodb.SequenceNumber,
    ...(paymentTxnRef ? { paymentTxnRef } : {})
  };
}
