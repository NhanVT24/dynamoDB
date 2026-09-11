import crypto from "node:crypto";
import { BadRequestException, Body, Controller, Get, Logger, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { env } from "../../config/env.js";
import { publishEventBridgeEvent } from "../../integrations/eventbridge/publisher.js";
import { getEmailDelivery, listEmailDeliveries } from "./email-delivery.repository.js";

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

  @Get()
  async list(@Query("limit") limit = "30") {
    const parsedLimit = Number(limit);
    const items = await listEmailDeliveries(Number.isFinite(parsedLimit) ? parsedLimit : 30);
    return { items: items.map((item) => publicMeta(item)) };
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
    const event = await publishEventBridgeEvent({
      busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
      source: "supermarket.email",
      detailType: "email.sale_campaign.requested",
      detail: {
        type: "email.sale_campaign.requested",
        campaignId: source.meta.relatedId ?? source.meta.id,
        emailJobId: retryEmailJobId,
        batchIndex: 0,
        batchCount: 1,
        senderEmail: source.meta.senderEmail,
        recipients,
        subject: source.meta.subject,
        html: source.meta.html,
        text: source.meta.text
      }
    });
    this.logger.log(JSON.stringify({ flow: "email_campaign", stage: "retry_eventbridge_published", sourceEmailId: source.meta.id, emailJobId: retryEmailJobId, eventId: event.eventId, recipientCount: recipients.length }));
    return { status: "queued", emailJobId: retryEmailJobId, recipientCount: recipients.length };
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
      const event = await publishEventBridgeEvent({
        busName: env.EVENTBRIDGE_PLATFORM_BUS_NAME,
        source: "supermarket.email",
        detailType: "email.sale_campaign.requested",
        detail: {
          type: "email.sale_campaign.requested",
          campaignId,
          emailJobId,
          batchIndex,
          batchCount: recipientBatches.length,
          senderEmail: env.SES_FROM_EMAIL,
          recipients,
          subject: input.subject,
          // The composer is plain text. Escaping prevents admin draft text
          // from becoming arbitrary HTML in the recipient inbox.
          html: plainTextAsHtml(input.body),
          text: input.body
        }
      });
      this.logger.log(JSON.stringify({
        flow: "email_campaign",
        stage: "eventbridge_published",
        campaignId,
        emailJobId,
        eventId: event.eventId,
        eventBusName: event.eventBusName,
        batchIndex,
        recipientCount: recipients.length
      }));
      return { emailJobId, eventId: event.eventId, recipientCount: recipients.length };
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
