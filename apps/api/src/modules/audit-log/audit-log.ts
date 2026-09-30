import { z } from "zod";

export type DynamoAttribute = {
  S?: string;
  N?: string;
  BOOL?: boolean;
  NULL?: boolean;
  M?: Record<string, DynamoAttribute>;
  L?: DynamoAttribute[];
  SS?: string[];
  NS?: string[];
};
type AttributeImage = Record<string, DynamoAttribute>;

const auditWriter = "lambda:supermarket-audit-log-worker";

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

const streamAttributeSchema = z.object({
  S: z.string().optional(),
  SS: z.array(z.string()).optional(),
  N: z.string().optional(),
  BOOL: z.boolean().optional(),
  NULL: z.boolean().optional()
}).passthrough();

const auditStreamSchema = z.object({
  eventID: z.string().min(1),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  dynamodb: z.object({
    Keys: z.object({
      PK: z.object({ S: z.string().min(1) }),
      SK: z.object({ S: z.string().min(1) })
    }).passthrough(),
    NewImage: z.record(z.string(), streamAttributeSchema).optional(),
    OldImage: z.record(z.string(), streamAttributeSchema).optional(),
    SequenceNumber: z.string().min(1),
    ApproximateCreationDateTime: z.number().finite()
  }).passthrough()
}).passthrough();

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
    const oldValue = classifyDynamoAttribute(oldImage?.[field]);
    const newValue = classifyDynamoAttribute(newImage?.[field]);
    if (areAuditValuesEqual(oldValue, newValue)) return [];
    const before = auditAttributeValue(oldValue);
    const after = auditAttributeValue(newValue);
    return [[field, { before, after }]];
  }));
}

type AuditValue =
  | { kind: "MISSING" }
  | { kind: "S" | "N"; value: string }
  | { kind: "BOOL"; value: boolean }
  | { kind: "NULL" }
  | { kind: "SS" | "NS"; value: Set<string> }
  | { kind: "L"; value: AuditValue[] }
  | { kind: "M"; value: Record<string, AuditValue> };

function areAuditValuesEqual(before: AuditValue, after: AuditValue): boolean {
  if (before.kind !== after.kind) return false;

  switch (before.kind) {
    case "MISSING":
    case "NULL":
      return true;
    case "S":
    case "N":
      return after.kind === before.kind && before.value === after.value;
    case "BOOL":
      return after.kind === "BOOL" && before.value === after.value;
    case "SS":
    case "NS":
      return after.kind === before.kind && areStringSetsEqual(before.value, after.value);
    case "L":
      return after.kind === "L"
        && before.value.length === after.value.length
        && before.value.every((value, index) => areAuditValuesEqual(value, after.value[index]));
    case "M": {
      if (after.kind !== "M") return false;
      const beforeKeys = Object.keys(before.value);
      const afterKeys = Object.keys(after.value);
      return beforeKeys.length === afterKeys.length
        && beforeKeys.every((key) => Object.hasOwn(after.value, key)
          && areAuditValuesEqual(before.value[key], after.value[key]));
    }
  }
}

function areStringSetsEqual(before: Set<string>, after: Set<string>): boolean {
  return before.size === after.size && [...before].every((value) => after.has(value));
}

function classifyDynamoAttribute(attribute: DynamoAttribute | undefined, depth = 0): AuditValue {
  if (attribute === undefined) return { kind: "MISSING" };
  if (depth > 32 || typeof attribute !== "object" || attribute === null || Array.isArray(attribute)) {
    throw new Error("Audit attribute has an invalid structure or exceeds maximum depth.");
  }
  const keys = Object.keys(attribute);
  if (keys.length !== 1) throw new Error("Audit attribute must contain exactly one DynamoDB type.");
  const type = keys[0];
  switch (type) {
    case "S":
    case "N": {
      const value = attribute[type];
      if (typeof value !== "string") throw new Error(`Audit ${type} value must be a string.`);
      return { kind: type, value };
    }
    case "BOOL":
      if (typeof attribute.BOOL !== "boolean") throw new Error("Audit BOOL value must be boolean.");
      return { kind: "BOOL", value: attribute.BOOL };
    case "NULL":
      if (attribute.NULL !== true) throw new Error("Audit NULL value must be true.");
      return { kind: "NULL" };
    case "SS":
    case "NS": {
      const values = attribute[type];
      if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
        throw new Error(`Audit ${type} value must be a string set.`);
      }
      return { kind: type, value: new Set(values) };
    }
    case "L": {
      if (!Array.isArray(attribute.L)) throw new Error("Audit L value must be a list.");
      return { kind: "L", value: attribute.L.map((value) => classifyDynamoAttribute(value, depth + 1)) };
    }
    case "M": {
      if (typeof attribute.M !== "object" || attribute.M === null || Array.isArray(attribute.M)) {
        throw new Error("Audit M value must be a map.");
      }
      return { kind: "M", value: Object.fromEntries(Object.entries(attribute.M).map(([key, value]) => [
        key, classifyDynamoAttribute(value, depth + 1)
      ])) };
    }
    default:
      throw new Error(`Unsupported DynamoDB audit attribute type: ${type}.`);
  }
}

type CanonicalAuditValue = string | boolean | CanonicalAuditValue[];

function auditAttributeValue(value: AuditValue): string | null {
  if (value.kind === "MISSING") return null;
  if (value.kind === "S") return value.value;
  if (value.kind === "SS") return JSON.stringify([...value.value].sort());
  return JSON.stringify(toCanonicalAuditValue(value));
}

function toCanonicalAuditValue(value: AuditValue): CanonicalAuditValue {
  switch (value.kind) {
    case "MISSING": return ["MISSING"];
    case "S":
    case "N":
    case "BOOL": return [value.kind, value.value];
    case "NULL": return ["NULL", true];
    case "SS":
    case "NS": return [value.kind, [...value.value].sort()];
    case "L": return ["L", value.value.map(toCanonicalAuditValue)];
    case "M": return ["M", Object.keys(value.value).sort().map((key) => [
      key, toCanonicalAuditValue(value.value[key])
    ])];
  }
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

export function parseAuditStreamMessage(message: unknown): AuditStreamRecord {
  return auditStreamSchema.parse(message) as AuditStreamRecord;
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
