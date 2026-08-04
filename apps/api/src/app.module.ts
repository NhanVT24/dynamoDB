import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { LearningModule } from "./modules/learning/learning.module.js";
import { ShoppingModule } from "./modules/shopping/shopping.module.js";

@Module({
  imports: [HealthModule, ShoppingModule, LearningModule]
})
export class AppModule {}
