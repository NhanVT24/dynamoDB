export type AuditResourceType = "ALL" | "ORDER" | "PAYMENT" | "USER";

export type AuditChange = {
  before: string | null;
  after: string | null;
};

export type AuditLogRecord = {
  PK: string;
  SK: string;
  resourceType: Exclude<AuditResourceType, "ALL">;
  resourceId: string;
  ownerEmail?: string;
  parentResourceType?: "ORDER";
  parentResourceId?: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  changes: Record<string, AuditChange>;
  actor?: {
    type?: string;
    id?: string;
    email?: string;
    role?: string;
  };
  context?: {
    source?: string;
    reason?: string;
    requestId?: string;
    auditWriter?: string;
  };
  paymentTxnRef?: string;
  occurredAt: string;
  source?: {
    pk?: string;
    sk?: string;
    eventId?: string;
    sequenceNumber?: string;
  };
};

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

export function resourceTone(resourceType: AuditLogRecord["resourceType"]) {
  if (resourceType === "ORDER") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (resourceType === "PAYMENT") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-violet-200 bg-violet-50 text-violet-800";
}

export function actionTone(action: AuditLogRecord["action"]) {
  if (action === "CREATED") return "bg-emerald-100 text-emerald-800";
  if (action === "DELETED") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

export function displayValue(value: string | null, field: string) {
  if (value === null) return "Not present";
  if (value === "") return "(empty string)";
  if (field === "avatarKey") return value.split("/").at(-1) ?? value;
  return value;
}

export function describePart(record: AuditLogRecord) {
  if (record.resourceType === "USER" && record.source?.sk === "AUTHORIZATION") return "User permissions";
  if (record.resourceType === "USER" && record.source?.sk === "PROFILE") return "User profile";
  if (record.resourceType === "ORDER") return "Order";
  return "Payment";
}

export function changedFieldCount(record: AuditLogRecord) {
  return Object.keys(record.changes ?? {}).length;
}

