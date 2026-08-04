import { Module } from "@nestjs/common";
import { LearningController } from "./learning.controller.js";

@Module({
  controllers: [LearningController]
})
export class LearningModule {}
