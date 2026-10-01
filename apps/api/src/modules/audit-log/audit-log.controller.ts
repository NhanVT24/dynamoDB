import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { AuditLogService } from "./audit-log.service.js";

@Controller("api/admin/audit-logs")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get("detail")
  async getAuditLog(
    @Req() request: FastifyRequest,
    @Query("pk") pk?: string,
    @Query("sk") sk?: string
  ) {
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.auditLogService.detail({ pk, sk });
  }

  @Get()
  async listAuditLogs(
    @Req() request: FastifyRequest,
    @Query("resourceType") resourceType?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string
  ) {
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.auditLogService.list({ resourceType, limit, cursor });
  }
}
