import { createStandaloneContext } from "../../../core/app/create-standalone-context.js";
import { NotificationsService } from "../../../modules/notifications/notifications.service.js";
import { StorefrontService } from "../../../modules/storefront/storefront.service.js";
import { UploadsService } from "../../../modules/uploads/uploads.service.js";

type QueueHandlerConfig = {
  lambdaName: string;
  worker: "storefront" | "notifications" | "uploads";
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

  return async (event: any) => {
    const records = normalizeSqsRecords(event);
    const firstPayload = (() => {
      try {
        return JSON.parse(String(records[0]?.body ?? ""));
      } catch {
        return null;
      }
    })();
    const correlationId = String(firstPayload?.correlationId ?? firstPayload?.requestId ?? "");

    if (records.length === 0) {
      console.log(`[lambda-sqs:${config.lambdaName}] skipped`, {
        correlationId,
        reason: "no_sqs_records",
        payloadShape: Array.isArray(event) ? "array" : typeof event
      });
      return { batchItemFailures: [] };
    }

    const appContext = await appContextPromise;
    const queueHandler = config.worker === "storefront"
      ? appContext.get(StorefrontService)
      : config.worker === "uploads"
        ? appContext.get(UploadsService)
        : appContext.get(NotificationsService);

    console.log(`[lambda-sqs:${config.lambdaName}] batch_received`, {
      correlationId,
      recordCount: records.length,
      payloadShape: Array.isArray(event) ? "array" : "records",
      queueArns: [...new Set(records.map((record: any) => String(record.eventSourceARN ?? ""))).values()]
    });

    const result = await queueHandler.processQueueRecords(records);
    const batchItemFailures = Array.isArray(result?.failedMessageIds)
      ? result.failedMessageIds.map((messageId: string) => ({ itemIdentifier: messageId }))
      : [];

    console.log(`[lambda-sqs:${config.lambdaName}] processed`, {
      correlationId,
      recordCount: records.length,
      processed: result?.processed ?? 0,
      failed: batchItemFailures.length,
      items: result?.items ?? []
    });

    return { batchItemFailures };
  };
}
