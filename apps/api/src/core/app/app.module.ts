import { Module } from "@nestjs/common";
import { AdminOpsModule } from "../../modules/admin-ops/admin-ops.module.js";
import { ConfigModule } from "../../config/config.module.js";
import { HealthModule } from "../../modules/health/health.module.js";
import { LearningModule } from "../../modules/learning/learning.module.js";
import { NotificationsModule } from "../../modules/notifications/notifications.module.js";
import { ShoppingModule } from "../../modules/shopping/shopping.module.js";
import { StorefrontModule } from "../../modules/storefront/storefront.module.js";
import { UploadsModule } from "../../modules/uploads/uploads.module.js";
import { VnpayModule } from "../../modules/vnpay/vnpay.module.js";

@Module({
  imports: [ConfigModule, AdminOpsModule, HealthModule, ShoppingModule, StorefrontModule, LearningModule, NotificationsModule, UploadsModule, VnpayModule]
})
export class AppModule {}
