import { Logger } from "@nestjs/common";

type QueueLogLevel = "log" | "warn" | "error";
type QueueEventKind = "summary" | "business_event" | "warn" | "error";

type QueueLogContext = {
  scope: "queue";
  queue: string;
  worker?: string;
  kind: QueueEventKind;
  eventType?: string;
  status?: string;
  message?: string;
  messageId?: string;
  recordCount?: number;
  processed?: number;
  failed?: number;
  requestId?: string;
  orderId?: string;
  notificationId?: string;
  txnRef?: string;
  productId?: string;
  itemIds?: string[];
  details?: Record<string, unknown>;
};

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "" && entry !== null)
  ) as T;
}

function write(logger: Logger, level: QueueLogLevel, payload: QueueLogContext) {
  const line = JSON.stringify(compact(payload));
  if (level === "warn") {
    logger.warn(line);
    return;
  }

  if (level === "error") {
    logger.error(line);
    return;
  }

  logger.log(line);
}

export function logQueueSummary(
  logger: Logger,
  payload: Omit<QueueLogContext, "scope" | "kind"> & { status: "received" | "processed" }
) {
  write(logger, "log", {
    scope: "queue",
    kind: "summary",
    ...payload
  });
}

export function logQueueBusinessEvent(
  logger: Logger,
  payload: Omit<QueueLogContext, "scope" | "kind">
) {
  write(logger, "log", {
    scope: "queue",
    kind: "business_event",
    ...payload
  });
}

export function logQueueWarn(
  logger: Logger,
  payload: Omit<QueueLogContext, "scope" | "kind" | "status"> & { status: string }
) {
  write(logger, "warn", {
    scope: "queue",
    kind: "warn",
    ...payload
  });
}

export function logQueueError(
  logger: Logger,
  payload: Omit<QueueLogContext, "scope" | "kind" | "status"> & { status: string }
) {
  write(logger, "error", {
    scope: "queue",
    kind: "error",
    ...payload
  });
}
