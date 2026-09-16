import { BadRequestException, Controller, Delete, ForbiddenException, Get, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { isProductPermission } from "../../common/auth/permissions.js";
import { AuthorizationService } from "./authorization.service.js";

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
}
