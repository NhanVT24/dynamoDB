import { Injectable } from "@nestjs/common";
import { NotificationUseCases, type NotificationEvent } from "./application/notifications.js";
import { logQueueWarn } from "../../common/logging/queue-logger.js";
function unwrapEventBridgeDetail<T extends Record<string, unknown>>(payload: T): T {
  const detail = payload.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as T
    : payload;
}


@Injectable()
export class NotificationsService extends NotificationUseCases {
  async processQueueRecords(
    records: Array<{ body?: string; messageId?: string }>,
    options?: { queueName?: string; workerName?: string }
  ) {
    const settled = await Promise.allSettled(records.map(async (record) => ({
      messageId: String(record.messageId ?? ""),
      item: await this.processQueueRecord(record.body, options?.queueName)
    })));

    const processedItems = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ messageId: string; item: unknown }>).value.item)
      .filter(Boolean);

    const failedMessageIds = settled
      .flatMap((result, index) => result.status === "rejected" ? [String(records[index]?.messageId ?? "")] : [])
      .filter(Boolean);

    return {
      processed: processedItems.length,
      failedMessageIds,
      items: processedItems
    };
  }


  private async processQueueRecord(body: string | undefined, queueName?: string) {
    if (!body) { logQueueWarn(this.logger, { queue: queueName ?? "notifications", status: "record_empty" }); return null; }
    return this.processEvent(unwrapEventBridgeDetail(JSON.parse(body)) as NotificationEvent, queueName);
  }
}
