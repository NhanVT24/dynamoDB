import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRequestPrincipal } from "../../common/auth/request-principal.js";
import { PaymentReviewAdministration } from "../storefront/application/payment-review-administration.js";

@Controller("api/admin/ops/payment-reviews")
export class PaymentRecoveryController {
  constructor(private readonly reviews: PaymentReviewAdministration<unknown>) {}
  private async admin(request: FastifyRequest) {
    return requireRequestPrincipal(request, { roles: ["admin"], message: "Only admin accounts can manage payment reviews." });
  }
  @Get()
  async list(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) {
    await this.admin(request);
    const input = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(4096).optional() }).parse(query);
    return this.reviews.list(input.limit, input.cursor);
  }
  @Post(":txnRef/resolve")
  async resolve(@Req() request: FastifyRequest, @Param("txnRef") rawRef: string, @Body() body: Record<string, unknown>) {
    const principal = await this.admin(request);
    const txnRef = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(rawRef);
    const input = z.object({ note: z.string().trim().min(10).max(1000), externalReference: z.string().trim().min(3).max(200) }).strict().parse(body);
    // Records an operator's independently verified resolution. No charge,
    // refund, order status or inventory change is performed by this endpoint.
    await this.reviews.resolve(txnRef, principal.subject, input.note, input.externalReference);
    return { success: true, txnRef, status: "payment_review_resolved" };
  }
}
