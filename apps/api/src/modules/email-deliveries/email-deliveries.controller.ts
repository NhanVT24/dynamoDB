import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { EmailAdministration } from "./application/email-administration.js";
const saleCampaignSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(1000).transform((items) => [...new Set(items.map((item) => item.trim().toLowerCase()))]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  // Clients retrying a timed-out HTTP call should reuse this value. It makes
  // email batch IDs deterministic and prevents duplicate delivery attempts.
  idempotencyKey: z.string().trim().min(1).max(128).optional()
});
const retrySchema = z.object({ idempotencyKey: z.string().trim().min(1).max(128).optional() });

@Controller("api/admin/email-deliveries")
export class EmailDeliveriesController {
 constructor(@Inject(EmailAdministration) private readonly useCases: EmailAdministration) {}
 @Get() list(@Query("limit") limit = "30") { return this.useCases.list(limit); }
 @Get("publish-failures") publishFailures(@Query("limit") limit = "50") { return this.useCases.publishFailures(limit); }
 @Post("publish-failures/:emailJobId/retry") retryPublishFailure(@Param("emailJobId") id: string) { return this.useCases.retryPublishFailure(id); }
 @Get(":emailId") detail(@Param("emailId") id: string) { return this.useCases.detail(id); }
 @Post(":emailId/retry") retrySafeRecipients(@Param("emailId") id: string, @Body() body: unknown) { return this.useCases.retrySafeRecipients(id, retrySchema.parse(body)); }
 @Post("sale") sendSaleCampaign(@Body() body: unknown) { const input = saleCampaignSchema.parse(body); return this.useCases.sendSaleCampaign({ ...input, recipients: input.recipients ?? [] }); }
}
