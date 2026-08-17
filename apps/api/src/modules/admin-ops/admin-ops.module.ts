import { Module } from "@nestjs/common";
import { AdminOpsController } from "./admin-ops.controller.js";
import { AdminOpsService } from "./admin-ops.service.js";

@Module({
  controllers: [AdminOpsController],
  providers: [AdminOpsService]
})
export class AdminOpsModule {}
