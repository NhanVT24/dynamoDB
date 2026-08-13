import { Body, Controller, Get, Headers, Ip, Post, Query } from "@nestjs/common";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { createVnpayFailureTestSchema, createVnpayPaymentSchema } from "./vnpay.schema.js";
import { VnpayService } from "./vnpay.service.js";

@Controller("api/payments/vnpay")
export class VnpayController {
  constructor(private readonly vnpayService: VnpayService) {}

  @Post("create")
  createPayment(@Body() rawBody: Record<string, unknown>, @Ip() ipAddress: string) {
    const input = createVnpayPaymentSchema.parse(rawBody);
    return this.vnpayService.createPaymentUrl(input, ipAddress);
  }

  @Get("return")
  async handleReturn(@Query() rawQuery: Record<string, unknown>) {
    return this.vnpayService.verifyReturn(rawQuery);
  }

  @Get("ipn")
  async handleIpn(@Query() rawQuery: Record<string, unknown>) {
    return this.vnpayService.verifyIpn(rawQuery);
  }

  @Post("test/fail")
  async createFailureTest(
    @Body() rawBody: Record<string, unknown>,
    @Headers() headers: Record<string, unknown>
  ) {
    const input = createVnpayFailureTestSchema.parse(rawBody);
    const principal = extractCognitoPrincipal(headers);

    if (!principal) {
      return {
        success: false,
        message: "Bạn cần đăng nhập để chạy test thanh toán thất bại."
      };
    }

    return this.vnpayService.createFailureTestNotification(principal.email, input);
  }
}
