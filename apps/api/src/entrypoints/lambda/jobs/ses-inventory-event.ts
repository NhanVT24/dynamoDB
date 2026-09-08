import "reflect-metadata";
import { updateEmailDeliveryStatus } from "../../../modules/email-deliveries/email-delivery.repository.js";
import { updateInventoryReportDeliveryStatus } from "../../../modules/inventory-reports/inventory-report.repository.js";

type SnsEvent = {
  Records?: Array<{ Sns?: { Message?: string } }>;
};

type SesEvent = {
  eventType?: string;
  mail?: {
    messageId?: string;
    timestamp?: string;
    tags?: Record<string, string[]>;
  };
};

function toDeliveryStatus(eventType: string) {
  switch (eventType) {
    case "Delivery": return "delivered" as const;
    case "Bounce": return "bounced" as const;
    case "Complaint": return "complained" as const;
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
    const emailId = sesEvent.mail?.tags?.emailId?.[0];
    if (!status || (!reportId && !emailId)) {
      return { ignored: "unrelated_ses_event" };
    }

    await Promise.all([
      reportId
        ? updateInventoryReportDeliveryStatus({ reportId, sesMessageId: sesEvent.mail?.messageId, status })
        : Promise.resolve(),
      emailId
        ? updateEmailDeliveryStatus({
          id: emailId,
          sesMessageId: sesEvent.mail?.messageId,
          status,
          providerEventType: String(sesEvent.eventType),
          providerEventAt: sesEvent.mail?.timestamp
        })
        : Promise.resolve()
    ]);
    return { reportId, emailId, status };
  }));

  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    console.error("[ses-inventory-event] processing_failed", {
      failureCount: failed.length,
      errors: failed.map((result) => {
        const reason = (result as PromiseRejectedResult).reason;
        return reason instanceof Error
          ? { name: reason.name, message: reason.message }
          : { message: String(reason) };
      })
    });
    throw new Error(`Failed to process ${failed.length} SES inventory event(s).`);
  }

  return { processed: results.length };
};
