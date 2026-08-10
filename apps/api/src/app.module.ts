import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { LearningModule } from "./modules/learning/learning.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { ShoppingModule } from "./modules/shopping/shopping.module.js";
import { ConfigModule } from "./config/config.module.js";
import { StorefrontModule } from "./modules/storefront/storefront.module.js";
import { UploadsModule } from "./modules/uploads/uploads.module.js";
import { VnpayModule } from "./modules/vnpay/vnpay.module.js";

@Module({
  imports: [ConfigModule, HealthModule, ShoppingModule, StorefrontModule, LearningModule, NotificationsModule, UploadsModule, VnpayModule]
})
export class AppModule {}
