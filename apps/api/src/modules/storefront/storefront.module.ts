import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ProductsPublicController } from "./products-public.controller.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontService } from "./storefront.service.js";

@Module({
  controllers: [StorefrontController, ProductsPublicController],
  imports: [NotificationsModule],
  providers: [StorefrontService]
})
export class StorefrontModule {}
