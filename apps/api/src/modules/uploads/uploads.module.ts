import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";

@Module({
  controllers: [UploadsController],
  providers: [UploadsService]
})
export class UploadsModule {}
