import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ShoppingController } from "./shopping.controller.js";
import { ShoppingService } from "./shopping.service.js";

@Module({
  imports: [NotificationsModule],
  controllers: [ShoppingController],
  providers: [ShoppingService]
})
export class ShoppingModule {}
