import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { VnpayController } from "./vnpay.controller.js";
import { VnpayService } from "./vnpay.service.js";

@Module({
  imports: [NotificationsModule],
  controllers: [VnpayController],
  providers: [VnpayService]
})
export class VnpayModule {}
