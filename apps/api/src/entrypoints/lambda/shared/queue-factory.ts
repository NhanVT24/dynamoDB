import { createNestApp } from "../../../core/app/create-app.js";
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
  const appPromise = createNestApp();

  return async (event: any) => {
    const records = normalizeSqsRecords(event);

    if (records.length === 0) {
      console.log(`[lambda-sqs:${config.lambdaName}] skipped`, {
        reason: "no_sqs_records",
        payloadShape: Array.isArray(event) ? "array" : typeof event
      });
      return { batchItemFailures: [] };
    }

    const app = await appPromise;
    const queueHandler = config.worker === "storefront"
      ? app.get(StorefrontService)
      : config.worker === "uploads"
        ? app.get(UploadsService)
        : app.get(NotificationsService);

    console.log(`[lambda-sqs:${config.lambdaName}] batch_received`, {
      recordCount: records.length,
      payloadShape: Array.isArray(event) ? "array" : "records",
      queueArns: [...new Set(records.map((record: any) => String(record.eventSourceARN ?? ""))).values()]
    });

    const result = await queueHandler.processQueueRecords(records);
    const batchItemFailures = Array.isArray(result?.failedMessageIds)
      ? result.failedMessageIds.map((messageId: string) => ({ itemIdentifier: messageId }))
      : [];

    console.log(`[lambda-sqs:${config.lambdaName}] processed`, {
      recordCount: records.length,
      processed: result?.processed ?? 0,
      failed: batchItemFailures.length,
      items: result?.items ?? []
    });

    return { batchItemFailures };
  };
}
