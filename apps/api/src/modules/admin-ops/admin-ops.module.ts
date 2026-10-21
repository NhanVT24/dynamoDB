import { Logger } from "@nestjs/common";
import { AwsAdminGateway } from "./infrastructure/aws-admin-gateway.js";
import { Module } from "@nestjs/common";
import { AdminOpsController } from "./admin-ops.controller.js";
import { AdminOpsService } from "./admin-ops.service.js";

@Module({
  controllers: [AdminOpsController],
  providers: [{provide:AdminOpsService,useFactory:()=>new AdminOpsService(new AwsAdminGateway(),new Logger(AdminOpsService.name))}]
})
export class AdminOpsModule {}
