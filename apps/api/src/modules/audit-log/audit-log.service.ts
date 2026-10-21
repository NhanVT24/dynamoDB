import { Injectable } from "@nestjs/common";
import { AuditQueries } from "./application/audit-queries.js";
import type { AuditLogRecord } from "./audit-log.js";
@Injectable()
export class AuditLogService extends AuditQueries<AuditLogRecord> {}
