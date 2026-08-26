import "reflect-metadata";
import { updateInventoryReportDeliveryStatus } from "../../../modules/inventory-reports/inventory-report.repository.js";

type SnsEvent = {
  Records?: Array<{ Sns?: { Message?: string } }>;
};

type SesEvent = {
  eventType?: string;
  mail?: {
    messageId?: string;
    tags?: Record<string, string[]>;
  };
};

function toDeliveryStatus(eventType: string) {
  switch (eventType) {
    case "Delivery": return "delivered" as const;
    case "Bounce": return "bounced" as const;
    case "Reject": return "rejected" as const;
    case "DeliveryDelay": return "delivery_delayed" as const;
    default: return null;
  }
}

export const handler = async (event: SnsEvent) => {
  const results = await Promise.allSettled((event.Records ?? []).map(async (record) => {
    const message = record.Sns?.Message;
    if (!message) return { ignored: "empty_message" };

    const sesEvent = JSON.parse(message) as SesEvent;
    const status = toDeliveryStatus(String(sesEvent.eventType ?? ""));
    const reportId = sesEvent.mail?.tags?.reportId?.[0];
    if (!status || !reportId) {
      return { ignored: "unrelated_ses_event" };
    }

    await updateInventoryReportDeliveryStatus({
      reportId,
      sesMessageId: sesEvent.mail?.messageId,
      status
    });
    return { reportId, status };
  }));

  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Failed to process ${failed.length} SES inventory event(s).`);
  }

  return { processed: results.length };
};
