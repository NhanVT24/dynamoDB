import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { env } from "../../config/env.js";
import { sendBulkSaleEmail } from "../../integrations/ses/bulk-mailer.js";

const saleCampaignSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(1000).transform((items) => [...new Set(items.map((item) => item.trim().toLowerCase()))]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000)
});

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
  @Post("sale")
  async sendSaleCampaign(@Body() body: unknown) {
    if (!env.SES_FROM_EMAIL) throw new BadRequestException("SES sender email is not configured.");
    const input = saleCampaignSchema.parse(body);
    const attempts = await sendBulkSaleEmail({
      senderEmail: env.SES_FROM_EMAIL,
      recipients: input.recipients,
      subject: input.subject,
      // The composer is plain text. Escaping on the server prevents an admin
      // draft from becoming arbitrary HTML in the recipient's inbox.
      html: plainTextAsHtml(input.body),
      text: input.body
    });
    return {
      recipientCount: input.recipients.length,
      attempts
    };
  }
}
