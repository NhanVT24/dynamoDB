import { Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { NotificationsService } from "./notifications.service.js";

@Controller("api/notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get("me")
  listMyNotifications(@Req() request: FastifyRequest) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      return { items: [], pendingCount: 0 };
    }

    return this.notificationsService.listForPrincipal(principal);
  }

  @Patch(":id/read")
  markAsRead(@Req() request: FastifyRequest, @Param("id") id: string) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      return { success: false };
    }

    return this.notificationsService.markAsReadForPrincipal(principal, id);
  }

  @Delete(":id")
  remove(@Req() request: FastifyRequest, @Param("id") id: string) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      return { success: false };
    }

    return this.notificationsService.removeForPrincipal(principal, id);
  }

  @Delete()
  removeAll(@Req() request: FastifyRequest) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      return { success: false };
    }

    return this.notificationsService.removeAllForPrincipal(principal);
  }
}





