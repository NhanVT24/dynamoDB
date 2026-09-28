import { z } from "zod";

type StringAttribute = { S?: string };

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

export type OrderAuditRecord = {
  PK: string;
  SK: string;
  entityType: "AUDIT_LOG_ORDER";
  orderId: string;
  sourceSK: "ORDER" | "DETAIL";
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  previousStatus?: string;
  status?: string;
  occurredAt: string;
  sourceEventId: string;
  sourceSequenceNumber: string;
};

const orderAuditMessageSchema = z.object({
  PK: z.string(),
  SK: z.string(),
  entityType: z.literal("AUDIT_LOG_ORDER"),
  orderId: z.string().min(1),
  sourceSK: z.enum(["ORDER", "DETAIL"]),
  eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
  previousStatus: z.string().optional(),
  status: z.string().optional(),
  occurredAt: z.iso.datetime(),
  sourceEventId: z.string().min(1),
  sourceSequenceNumber: z.string().min(1)
}).strict();

export function parseOrderAuditMessage(body: string | undefined): OrderAuditRecord {
  if (!body) throw new Error("Order audit queue message is empty.");
  const audit = orderAuditMessageSchema.parse(JSON.parse(body));
  if (audit.PK !== `AUDIT_LOG_ORDER#${audit.orderId}`
    || audit.SK !== `EVENT#${audit.occurredAt}#${audit.sourceEventId}`
    || (audit.eventName === "REMOVE" ? !audit.previousStatus || audit.status !== undefined : !audit.status)) {
    throw new Error("Order audit queue message has invalid identity or status.");
  }
  return audit;
}

export function buildOrderAuditRecord(record: OrderStreamRecord): OrderAuditRecord | null {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.PK?.S ?? "";
  const sk = keys?.SK?.S ?? "";
  if (!pk.startsWith("ORDER#") || (sk !== "ORDER" && sk !== "DETAIL")) return null;

  const eventName = record.eventName;
  if (eventName !== "INSERT" && eventName !== "MODIFY" && eventName !== "REMOVE") return null;
  if (!record.eventID || !record.dynamodb?.SequenceNumber) throw new Error("Order stream record is missing its event identity.");

  const previousStatus = record.dynamodb.OldImage?.status?.S;
  const status = record.dynamodb.NewImage?.status?.S;
  if (eventName === "INSERT" && !status) throw new Error("Inserted order is missing status.");
  if (eventName === "MODIFY" && !status) throw new Error("Updated order is missing status.");
  if (eventName === "REMOVE" && !previousStatus) throw new Error("Removed order is missing previous status.");
  if (eventName === "MODIFY" && previousStatus === status) return null;

  const eventTime = record.dynamodb.ApproximateCreationDateTime;
  if (typeof eventTime !== "number" || !Number.isFinite(eventTime)) {
    throw new Error("Order stream record is missing its creation time.");
  }
  const occurredAt = new Date(eventTime * 1000).toISOString();
  const orderId = pk.slice("ORDER#".length);
  if (!orderId) throw new Error("Order stream record has an empty order ID.");

  return {
    PK: `AUDIT_LOG_ORDER#${orderId}`,
    SK: `EVENT#${occurredAt}#${record.eventID}`,
    entityType: "AUDIT_LOG_ORDER",
    orderId,
    sourceSK: sk,
    eventName,
    ...(previousStatus ? { previousStatus } : {}),
    ...(status && eventName !== "REMOVE" ? { status } : {}),
    occurredAt,
    sourceEventId: record.eventID,
    sourceSequenceNumber: record.dynamodb.SequenceNumber
  };
}
