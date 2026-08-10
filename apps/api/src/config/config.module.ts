import { Module } from "@nestjs/common";
import { RuntimeConfigService } from "./runtime-config.service.js";

@Module({
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService]
})
export class ConfigModule {}
