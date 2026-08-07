import { Controller, Get, Param, Patch, Req } from "@nestjs/common";
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

    return this.notificationsService.listForCustomer(principal.email);
  }

  @Patch(":id/read")
  markAsRead(@Req() request: FastifyRequest, @Param("id") id: string) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      return { success: false };
    }

    return this.notificationsService.markAsRead(principal.email, id);
  }
}
