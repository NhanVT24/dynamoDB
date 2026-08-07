import { Body, Controller, Get, Ip, Post, Query } from "@nestjs/common";
import { createVnpayPaymentSchema } from "./vnpay.schema.js";
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
  handleReturn(@Query() rawQuery: Record<string, unknown>) {
    return this.vnpayService.verifyReturn(rawQuery);
  }

  @Get("ipn")
  handleIpn(@Query() rawQuery: Record<string, unknown>) {
    return this.vnpayService.verifyIpn(rawQuery);
  }
}
