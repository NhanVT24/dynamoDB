import { auditReader } from "./infrastructure/audit-reader.js";
import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller.js";
import { AuditLogService } from "./audit-log.service.js";

@Module({
  controllers: [AuditLogController],
  providers: [{ provide: AuditLogService, useFactory: () => new AuditLogService(auditReader) }]
})
export class AuditLogModule {}
