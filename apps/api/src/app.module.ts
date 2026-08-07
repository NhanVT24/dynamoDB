import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { LearningModule } from "./modules/learning/learning.module.js";
import { ShoppingModule } from "./modules/shopping/shopping.module.js";
import { StorefrontModule } from "./modules/storefront/storefront.module.js";
import { UploadsModule } from "./modules/uploads/uploads.module.js";

@Module({
  imports: [HealthModule, ShoppingModule, StorefrontModule, LearningModule, UploadsModule]
})
export class AppModule {}
