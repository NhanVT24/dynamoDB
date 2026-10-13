import { Logger } from "@nestjs/common";
import {
  logQueueError,
  logQueueSummary,
  logQueueWarn
} from "../../../common/logging/queue-logger.js";
import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { NotificationsService } from "../../../modules/notifications/notifications.service.js";
import { StorefrontService } from "../../../modules/storefront/storefront.service.js";
import { UploadsService } from "../../../modules/uploads/uploads.service.js";
import { runIdempotent } from "./sqs-idempotency.js";

type QueueHandlerConfig = {
  lambdaName: string;
  worker: "storefront" | "notifications" | "payments" | "uploads";
  queueName: string;
};

type SqsRecord = {
  body?: string;
  messageId?: string;
  eventSource?: string;
  eventSourceARN?: string;
};

type QueueProcessResult = {
  processed?: number;
  failedMessageIds?: string[];
  items?: unknown[];
};

function normalizeSqsRecords(event: any): SqsRecord[] {
  const candidates = Array.isArray(event)
    ? event
    : Array.isArray(event?.Records)
      ? event.Records
      : [];

  return candidates.filter((record: any) => record?.eventSource === "aws:sqs");
}

function idempotencyKey(record: SqsRecord) {
  try {
    const envelope = JSON.parse(String(record.body ?? "")) as { id?: unknown };
    const eventId = typeof envelope.id === "string" ? envelope.id.trim() : "";
    if (eventId) return `eventbridge:${eventId}`;
  } catch {
    // The service validates malformed payloads and decides whether to retry it.
  }
  const messageId = String(record.messageId ?? "").trim();
  return messageId ? `sqs:${messageId}` : undefined;
}

export function createQueueHandler(config: QueueHandlerConfig) {
  const appContextPromise = createStandaloneContext();
  const logger = new Logger(`QueueLambda:${config.lambdaName}`);

  return async (event: any, context?: { awsRequestId?: string }) => {
    const records = normalizeSqsRecords(event);
    const batchId = String(context?.awsRequestId ?? records.map((record) => record.messageId).filter(Boolean).join(":"));
    const firstPayload = (() => {
      try {
        return JSON.parse(String(records[0]?.body ?? ""));
      } catch {
        return null;
      }
    })();
    const correlationId = String(firstPayload?.correlationId ?? firstPayload?.requestId ?? "");

    if (records.length === 0) {
      logQueueWarn(logger, {
        queue: config.queueName,
        worker: config.lambdaName,
        status: "skipped_no_records",
        requestId: correlationId,
        details: {
          payloadShape: Array.isArray(event) ? "array" : typeof event
        }
      });
      return { batchItemFailures: [] };
    }

    logQueueSummary(logger, {
      queue: config.queueName,
      worker: config.lambdaName,
      status: "received",
      requestId: correlationId,
      recordCount: records.length,
      details: {
        batchId,
        payloadShape: Array.isArray(event) ? "array" : "records",
        queueArns: [...new Set(records.map((record: any) => String(record.eventSourceARN ?? ""))).values()]
      }
    });

    const appContext = await appContextPromise;

    try {
      const processRecord = async (record: SqsRecord): Promise<QueueProcessResult> => {
        const process = () => config.worker === "storefront"
          ? appContext.get(StorefrontService).processQueueRecords([record], {
            queueName: config.queueName,
            workerName: config.lambdaName
          })
          : config.worker === "uploads"
            ? appContext.get(UploadsService).processQueueRecords([record], {
              queueName: config.queueName,
              workerName: config.lambdaName
            })
            : appContext.get(NotificationsService).processQueueRecords([record], {
              queueName: config.queueName,
              workerName: config.lambdaName
            });

        const key = idempotencyKey(record);
        if (!key) return process();

        let result: QueueProcessResult | undefined;
        const outcome = await runIdempotent({
          worker: config.lambdaName,
          id: key,
          execute: async () => {
            result = await process();
            if (result.failedMessageIds?.length) {
              throw new Error(`Worker ${config.lambdaName} reported a failed queue record.`);
            }
            return "completed";
          }
        });
        if (outcome === "busy") {
          throw new Error(`Queue record ${key} is already being processed by ${config.lambdaName}.`);
        }
        if (outcome === "duplicate" || outcome === "unknown") {
          logQueueSummary(logger, {
            queue: config.queueName,
            worker: config.lambdaName,
            status: "processed",
            itemIds: [key],
            details: { idempotency: outcome }
          });
          return { processed: 1, items: [{ idempotencyKey: key, idempotency: outcome }] };
        }
        return result ?? { processed: 1 };
      };

      const settled = await Promise.allSettled(records.map(processRecord));
      const batchItemFailures = settled.flatMap((item, index) => item.status === "rejected" && records[index]?.messageId
        ? [{ itemIdentifier: records[index].messageId! }]
        : []);
      const processedItems = settled.flatMap((item) => item.status === "fulfilled" ? item.value.items ?? [] : []);
      const processed = settled.reduce((total, item) => total + (item.status === "fulfilled" ? item.value.processed ?? 0 : 0), 0);

      logQueueSummary(logger, {
        queue: config.queueName,
        worker: config.lambdaName,
        status: "processed",
        requestId: correlationId,
        recordCount: records.length,
        processed,
        failed: batchItemFailures.length,
        itemIds: processedItems
          .flatMap((item) => {
            const value = item as Record<string, unknown>;
            return [value.txnRef, value.orderId, value.notificationId, value.productId, value.requestId];
          })
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .slice(0, 5)
      });

      return { batchItemFailures };
    } catch (error) {
      logQueueError(logger, {
        queue: config.queueName,
        worker: config.lambdaName,
        status: "batch_failed",
        requestId: correlationId,
        message: error instanceof Error ? error.message : "unknown"
      });

      throw error;
    }
  };
}
