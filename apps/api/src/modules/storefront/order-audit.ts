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
