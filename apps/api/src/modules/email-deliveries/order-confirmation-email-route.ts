import crypto from "node:crypto";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import type { OrderConfirmationInput } from "../../integrations/ses/order-confirmation-template.js";
import { env } from "../../config/env.js";
import { nextEmailPublishRetryAt } from "./email-publish-retry.js";
import {
  ensureEmailRoute,
  markEmailRoutePublished,
  markEmailRoutePublishRetry
} from "./email-route.repository.js";

type OrderConfirmationEmailJob = OrderConfirmationInput & {
  type: "email.order_confirmation.requested";
  emailJobId: string;
  campaignId: string;
  batchIndex: 0;
  batchCount: 1;
};

// One confirmation belongs to one order. The deterministic ID makes a retry
// of the order event reuse the same durable route instead of sending twice.
export async function queueOrderConfirmationEmail(input: OrderConfirmationInput) {
  if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) {
    throw new Error("Missing EVENTBRIDGE_PLATFORM_BUS_NAME for order confirmation email.");
  }

  const emailJobId = crypto.createHash("sha256").update(`order-confirmation:${input.orderId}`).digest("hex");
  const campaignId = `order-confirmation:${input.orderId}`;
  const detail: OrderConfirmationEmailJob = {
    type: "email.order_confirmation.requested",
    emailJobId,
    campaignId,
    batchIndex: 0,
    batchCount: 1,
    ...input
  };
  const event = {
    busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
    source: "supermarket.email",
    detailType: "email.order_confirmation.requested",
    detail
  };

  const created = await ensureEmailRoute({ emailJobId, campaignId, batchIndex: 0, batchCount: 1, event });
  if (!created) return { emailJobId, status: "already_queued" as const };

  try {
    const published = await publishEventBridgeEvent(event);
    await markEmailRoutePublished({ emailJobId, eventId: published.eventId });
    return { emailJobId, status: "queued" as const, eventId: published.eventId };
  } catch (error) {
    const scheduled = await markEmailRoutePublishRetry({
      emailJobId,
      attempt: 1,
      reason: error instanceof Error ? error.message : "Unknown EventBridge publish failure",
      nextPublishAt: nextEmailPublishRetryAt(1)
    });
    return { emailJobId, status: scheduled ? "retry_scheduled" as const : "publish_unknown" as const };
  }
}
