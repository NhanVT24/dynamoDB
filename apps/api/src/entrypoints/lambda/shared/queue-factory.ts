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

type QueueHandlerConfig = {
  lambdaName: string;
  worker: "storefront" | "checkoutGate" | "notifications" | "payments" | "uploads";
  queueName: string;
};

type SqsRecord = {
  body?: string;
  messageId?: string;
  eventSource?: string;
  eventSourceARN?: string;
};

function normalizeSqsRecords(event: any): SqsRecord[] {
  const candidates = Array.isArray(event)
    ? event
    : Array.isArray(event?.Records)
      ? event.Records
      : [];

  return candidates.filter((record: any) => record?.eventSource === "aws:sqs");
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

    // Keep the FIFO message in flight while waiting, so the next message in the
    // shared checkout lane cannot begin its business processing first.
    if (config.worker === "checkoutGate") {
      logger.log(`[checkout-fifo] start_delay batchId=${batchId} delayMs=5000`);
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    }

    const appContext = await appContextPromise;

    try {
      const result = config.worker === "checkoutGate"
        ? await appContext.get(StorefrontService).processCheckoutGateRecords(records, {
          queueName: config.queueName,
          workerName: config.lambdaName,
          batchId
        })
        : config.worker === "storefront"
          ? await appContext.get(StorefrontService).processQueueRecords(records, {
            queueName: config.queueName,
            workerName: config.lambdaName
          })
        : config.worker === "uploads"
            ? await appContext.get(UploadsService).processQueueRecords(records, {
              queueName: config.queueName,
              workerName: config.lambdaName
            })
            : await appContext.get(NotificationsService).processQueueRecords(records, {
              queueName: config.queueName,
              workerName: config.lambdaName
            });
      const batchItemFailures = Array.isArray(result?.failedMessageIds)
        ? result.failedMessageIds.map((messageId: string) => ({ itemIdentifier: messageId }))
        : [];

      logQueueSummary(logger, {
        queue: config.queueName,
        worker: config.lambdaName,
        status: "processed",
        requestId: correlationId,
        recordCount: records.length,
        processed: result?.processed ?? 0,
        failed: batchItemFailures.length,
        itemIds: (result?.items ?? [])
          .flatMap((item: any) => [item?.txnRef, item?.orderId, item?.notificationId, item?.productId, item?.requestId])
          .filter(Boolean)
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
