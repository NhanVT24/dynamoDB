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
  if (field === "addresses") return formatAddressValue(value);
  return value;
}

export type ParsedAuditValue =
  | { kind: "missing"; value: null }
  | { kind: "primitive"; value: string }
  | { kind: "array"; value: unknown[] }
  | { kind: "object"; value: Record<string, unknown> };

export function parseAuditValue(value: string | null): ParsedAuditValue {
  if (value === null) return { kind: "missing", value: null };
  if (value === "") return { kind: "primitive", value: "(empty string)" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return { kind: "array", value: parsed };
    if (parsed && typeof parsed === "object") return { kind: "object", value: parsed as Record<string, unknown> };
    return { kind: "primitive", value: String(parsed) };
  } catch {
    return { kind: "primitive", value };
  }
}

export function displayNestedValue(value: unknown) {
  if (value === null || value === undefined) return "Not present";
  if (typeof value === "string") return value || "(empty string)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function summarizeChange(change: AuditChange, field: string) {
  const before = parseAuditValue(change.before);
  const after = parseAuditValue(change.after);
  if (field === "permissions" && before.kind === "array" && after.kind === "array") {
    const previous = before.value.map(String);
    const next = after.value.map(String);
    const added = next.filter((item) => !previous.includes(item));
    const removed = previous.filter((item) => !next.includes(item));
    return [
      added.length ? `Added ${added.join(", ")}` : "",
      removed.length ? `Removed ${removed.join(", ")}` : ""
    ].filter(Boolean).join("; ") || "No visible permission delta";
  }
  if (field === "addresses" && after.kind === "array") {
    return after.value.length ? `${after.value.length} location${after.value.length === 1 ? "" : "s"} saved` : "No saved location";
  }
  return `${displayValue(change.before, field)} -> ${displayValue(change.after, field)}`;
}

export function fieldLabel(field: string) {
  if (field === "avatarKey") return "Avatar";
  if (field === "displayName") return "Display name";
  if (field === "addresses") return "Addresses";
  return field;
}

function formatAddressValue(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return "No addresses";
    const lines = parsed.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const address = item as Record<string, unknown>;
      const ward = String(address.ward || "").trim();
      const city = String(address.city || "").trim();
      const province = String(address.province || "").trim();
      if (!ward && !city && !province) return [];
      const value = [ward, city, province].filter(Boolean).join(", ");
      return [parsed.length === 1 ? value : `Address ${index + 1}: ${value}`];
    });
    return lines.join("\n") || "No addresses";
  } catch {
    return value;
  }
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

