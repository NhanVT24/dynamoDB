import { createNestApp } from "../app.js";
import { NotificationsService } from "../modules/notifications/notifications.service.js";
import { StorefrontService } from "../modules/storefront/storefront.service.js";

type QueueHandlerConfig = {
  lambdaName: string;
  worker: "storefront" | "notifications";
};

export function createQueueHandler(config: QueueHandlerConfig) {
  const appPromise = createNestApp();

  return async (event: any) => {
    const records = Array.isArray(event?.Records) ? event.Records.filter((record: any) => record?.eventSource === "aws:sqs") : [];

    if (records.length === 0) {
      console.log(`[lambda-sqs:${config.lambdaName}] skipped`, {
        reason: "no_sqs_records"
      });
      return { batchItemFailures: [] };
    }

    const app = await appPromise;
    const queueHandler = config.worker === "storefront"
      ? app.get(StorefrontService)
      : app.get(NotificationsService);

    console.log(`[lambda-sqs:${config.lambdaName}] batch_received`, {
      recordCount: records.length,
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
