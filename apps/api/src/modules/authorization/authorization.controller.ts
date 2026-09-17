import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { isProductPermission } from "../../common/auth/permissions.js";
import { AuthorizationService } from "./authorization.service.js";

const accountStatuses = new Set(["ACTIVE", "SUSPENDED", "DISABLED", "BLOCKED"]);

@Controller("api/admin/authorizations")
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Get("users")
  async listUsers(@Req() request: FastifyRequest) {
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.authorizationService.listUsers();
  }

  @Put("users/:subject/permissions/:permission")
  async addPermission(@Req() request: FastifyRequest, @Param("subject") subject: string, @Param("permission") permission: string) {
    if (!isProductPermission(permission)) throw new BadRequestException("Unsupported permission");
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.authorizationService.addPermission(subject, permission, actor.subject);
  }

  @Delete("users/:subject/permissions/:permission")
  async removePermission(@Req() request: FastifyRequest, @Param("subject") subject: string, @Param("permission") permission: string) {
    if (!isProductPermission(permission)) throw new BadRequestException("Unsupported permission");
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.authorizationService.removePermission(subject, permission, actor.subject);
  }

  @Put("users/:subject/status")
  async updateStatus(@Req() request: FastifyRequest, @Param("subject") subject: string, @Body() body: { status?: string }) {
    const status = String(body?.status || "").trim().toUpperCase();
    if (!accountStatuses.has(status)) throw new BadRequestException("Unsupported account status");
    const actor = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!actor || actor.role !== "admin") throw new ForbiddenException("Admin principal is required");
    return this.authorizationService.updateAccountStatus(subject, status as "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED", actor.subject);
  }
}
