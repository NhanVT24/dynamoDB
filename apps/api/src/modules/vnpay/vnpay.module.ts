import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { VnpayController } from "./vnpay.controller.js";
import { VnpayService } from "./vnpay.service.js";

@Module({
  imports: [ConfigModule, NotificationsModule],
  controllers: [VnpayController],
  providers: [VnpayService],
  exports: [VnpayService]
})
export class VnpayModule {}
