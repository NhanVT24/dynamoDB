import crypto from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, Get, Logger, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { env } from "../../config/env.js";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import { getEmailDelivery, listEmailDeliveriesWithStatus } from "./email-delivery.repository.js";
import {
  ensureEmailRoute,
  listFailedEmailRoutePublishes,
  markEmailRoutePublished,
  markEmailRoutePublishRetry,
  retryFailedEmailRoutePublish
} from "./email-route.repository.js";
import { nextEmailPublishRetryAt } from "./email-publish-retry.js";

const saleCampaignSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(1000).transform((items) => [...new Set(items.map((item) => item.trim().toLowerCase()))]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  // Clients retrying a timed-out HTTP call should reuse this value. It makes
  // email batch IDs deterministic and prevents duplicate delivery attempts.
  idempotencyKey: z.string().trim().min(1).max(128).optional()
});
const retrySchema = z.object({ idempotencyKey: z.string().trim().min(1).max(128).optional() });
const safeRetryStatuses = new Set(["failed", "not_sent", "rejected"]);

function publicMeta(meta: Awaited<ReturnType<typeof getEmailDelivery>> extends { meta: infer T } ? T : never) {
  const { html: _html, text: _text, ...safe } = meta as typeof meta & { html?: string; text?: string };
  return safe;
}

function plainTextAsHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br />");
}

@Controller("api/admin/email-deliveries")
export class EmailDeliveriesController {
  private readonly logger = new Logger(EmailDeliveriesController.name);

  private async publishTrackedSaleEvent(input: {
    campaignId: string;
    emailJobId: string;
    batchIndex: number;
    batchCount: number;
    senderEmail: string;
    recipients: string[];
    subject: string;
    html: string;
    text: string;
  }) {
    const trackedEvent = {
      busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
      source: "supermarket.email",
      detailType: "email.sale_campaign.requested",
      detail: {
        type: "email.sale_campaign.requested",
        campaignId: input.campaignId,
        emailJobId: input.emailJobId,
        batchIndex: input.batchIndex,
        batchCount: input.batchCount,
        senderEmail: input.senderEmail,
        recipients: input.recipients,
        subject: input.subject,
        html: input.html,
        text: input.text
      }
    };

    await ensureEmailRoute({
      emailJobId: input.emailJobId,
      campaignId: input.campaignId,
      batchIndex: input.batchIndex,
      batchCount: input.batchCount,
      event: trackedEvent
    });

    try {
      const event = await publishEventBridgeEvent(trackedEvent);

      await markEmailRoutePublished({
        emailJobId: input.emailJobId,
        eventId: event.eventId
      });
      return event;
    } catch (error) {
      // SDK/network errors can be ambiguous: EventBridge may have accepted the
      // event even when the caller did not receive a response. Never call this
      // a definite failure or blindly generate a new emailJobId.
      try {
        const recoveryScheduled = await markEmailRoutePublishRetry({
          emailJobId: input.emailJobId,
          reason: error instanceof Error ? error.message : "Unknown EventBridge publish failure",
          attempt: 1,
          nextPublishAt: nextEmailPublishRetryAt(1)
        });
        return {
          eventBusName: trackedEvent.busName ?? "",
          eventId: "",
          recoveryScheduled,
          publishOutcome: recoveryScheduled ? "RETRY_SCHEDULED" as const : "ACCEPTED_OR_ALREADY_ADVANCED" as const
        };
      } catch (trackingError) {
        this.logger.error(JSON.stringify({
          flow: "email_routing",
          stage: "publish_unknown_tracking_failed",
          emailJobId: input.emailJobId,
          message: trackingError instanceof Error ? trackingError.message : "unknown"
        }));
        throw error;
      }
    }
  }

  @Get()
  async list(@Query("limit") limit = "30") {
    const parsedLimit = Number(limit);
    const items = await listEmailDeliveriesWithStatus(Number.isFinite(parsedLimit) ? parsedLimit : 30);
    return { items: items.map((item) => publicMeta(item)) };
  }

  @Get("publish-failures")
  async publishFailures(@Query("limit") limit = "50") {
    const parsedLimit = Number(limit);
    const routes = await listFailedEmailRoutePublishes(Number.isFinite(parsedLimit) ? parsedLimit : 50);
    return {
      items: routes.map((route) => ({
        emailJobId: route.emailJobId,
        campaignId: route.campaignId,
        batchIndex: route.batchIndex,
        batchCount: route.batchCount,
        subject: typeof route.eventDetail?.subject === "string" ? route.eventDetail.subject : undefined,
        recipientCount: Array.isArray(route.eventDetail?.recipients) ? route.eventDetail.recipients.length : undefined,
        eventBusName: route.eventBusName,
        eventSource: route.eventSource,
        eventDetailType: route.eventDetailType,
        publishAttempts: route.publishAttempts,
        manualRetryCount: route.manualRetryCount ?? 0,
        failureReason: route.publishFailureReason,
        failedAt: route.updatedAt
      }))
    };
  }

  @Post("publish-failures/:emailJobId/retry")
  async retryPublishFailure(@Param("emailJobId") emailJobId: string) {
    const normalizedId = emailJobId.trim();
    if (!normalizedId || normalizedId.length > 128) throw new BadRequestException("Invalid email job ID.");

    const scheduled = await retryFailedEmailRoutePublish(normalizedId);
    if (!scheduled) {
      throw new ConflictException("This publish is missing, already being retried, or has already advanced.");
    }

    this.logger.warn(JSON.stringify({
      flow: "email_routing",
      stage: "admin_publish_retry_scheduled",
      emailJobId: normalizedId
    }));
    return { status: "retry_scheduled", emailJobId: normalizedId };
  }

  @Get(":emailId")
  async detail(@Param("emailId") emailId: string) {
    const delivery = await getEmailDelivery(emailId.trim());
    if (!delivery) throw new NotFoundException("Email delivery not found.");
    return { meta: publicMeta(delivery.meta), recipients: delivery.recipients };
  }

  @Post(":emailId/retry")
  async retrySafeRecipients(@Param("emailId") emailId: string, @Body() body: unknown) {
    if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) throw new BadRequestException("EventBridge platform bus is not configured.");
    const source = await getEmailDelivery(emailId.trim());
    if (!source) throw new NotFoundException("Email delivery not found.");
    if (!source.meta.html || !source.meta.text) {
      throw new BadRequestException("This legacy delivery does not retain its content and cannot be retried safely.");
    }
    const recipients = source.recipients.filter((recipient) => safeRetryStatuses.has(recipient.status)).map((recipient) => recipient.recipientEmail);
    if (!recipients.length) throw new BadRequestException("No recipient has a safely retryable delivery status.");

    const input = retrySchema.parse(body);
    const retryKey = input.idempotencyKey ?? crypto.randomUUID();
    const retryEmailJobId = crypto.createHash("sha256").update(`${source.meta.id}:retry:${retryKey}`).digest("hex");
    const event = await this.publishTrackedSaleEvent({
      campaignId: source.meta.relatedId ?? source.meta.id,
      emailJobId: retryEmailJobId,
      batchIndex: 0,
      batchCount: 1,
      senderEmail: source.meta.senderEmail,
      recipients,
      subject: source.meta.subject,
      html: source.meta.html,
      text: source.meta.text
    });
    this.logger.log(JSON.stringify({ flow: "email_campaign", stage: event.eventId ? "retry_eventbridge_published" : "retry_eventbridge_recovery_scheduled", sourceEmailId: source.meta.id, emailJobId: retryEmailJobId, eventId: event.eventId, recipientCount: recipients.length }));
    return { status: event.eventId ? "queued" : "retry_scheduled", emailJobId: retryEmailJobId, recipientCount: recipients.length };
  }

  @Post("sale")
  async sendSaleCampaign(@Body() body: unknown) {
    if (!env.SES_FROM_EMAIL) throw new BadRequestException("SES sender email is not configured.");
    if (!env.EVENTBRIDGE_PLATFORM_BUS_NAME) throw new BadRequestException("EventBridge platform bus is not configured.");
    const input = saleCampaignSchema.parse(body);
    const campaignId = input.idempotencyKey ?? crypto.randomUUID();
    const recipientBatches = Array.from(
      { length: Math.ceil(input.recipients.length / 50) },
      (_, index) => input.recipients.slice(index * 50, (index + 1) * 50)
    );

    const published = await Promise.all(recipientBatches.map(async (recipients, batchIndex) => {
      const emailJobId = crypto.createHash("sha256").update(`${campaignId}:${batchIndex}`).digest("hex");
      const event = await this.publishTrackedSaleEvent({
        campaignId,
        emailJobId,
        batchIndex,
        batchCount: recipientBatches.length,
        senderEmail: env.SES_FROM_EMAIL!,
        recipients,
        subject: input.subject,
        // The composer is plain text. Escaping prevents admin draft text
        // from becoming arbitrary HTML in the recipient inbox.
        html: plainTextAsHtml(input.body),
        text: input.body
      });
      this.logger.log(JSON.stringify({
        flow: "email_campaign",
        stage: event.eventId ? "eventbridge_published" : "eventbridge_recovery_scheduled",
        campaignId,
        emailJobId,
        eventId: event.eventId,
        eventBusName: event.eventBusName,
        batchIndex,
        recipientCount: recipients.length
      }));
      return { emailJobId, eventId: event.eventId, recoveryScheduled: "recoveryScheduled" in event ? event.recoveryScheduled : false, recipientCount: recipients.length };
    }));

    return {
      campaignId,
      status: "queued",
      recipientCount: input.recipients.length,
      batchCount: published.length,
      batches: published
    };
  }
}
