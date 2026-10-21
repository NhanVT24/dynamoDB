import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { shoppingListQuerySchema, shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { requireRequestPrincipal } from "../../common/auth/request-principal.js";
import { StorefrontService } from "./storefront.service.js";
import { createStorefrontOrderSchema } from "./storefront.schema.js";

@Controller("api/storefront")
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get("products")
  listProducts(@Query() rawQuery: Record<string, unknown>) {
    return this.storefrontService.listProducts(shoppingListQuerySchema.parse(rawQuery));
  }

  @Get("products/:id")
  getProductById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    return this.storefrontService.getProductById(id);
  }

  @Post("orders")
  @HttpCode(HttpStatus.ACCEPTED)
  async createOrder(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await requireRequestPrincipal(request, { roles: ["customer", "admin"], message: "Only customer or admin can create orders." });

    const input = createStorefrontOrderSchema.parse(rawBody);
    return this.storefrontService.createOrder(principal.email, input);
  }

  @Get("orders/:orderId/status")
  async getOrderStatus(@Req() request: FastifyRequest, @Param("orderId") orderId: string) {
    const principal = await requireRequestPrincipal(request, { message: "Sign in to view your order." });
    return this.storefrontService.getOrderStatus(principal.email, orderId);
  }

  @Post("orders/:orderId/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelOrder(@Req() request: FastifyRequest, @Param("orderId") orderId: string) {
    const principal = await requireRequestPrincipal(request, { roles: ["customer", "admin"], message: "Only customer or admin can cancel orders." });

    return this.storefrontService.cancelOrder(principal.email, orderId);
  }

  @Post("orders/:orderId/refund")
  @HttpCode(HttpStatus.OK)
  async refundOrder(@Req() request: FastifyRequest, @Param("orderId") orderId: string) {
    const principal = await requireRequestPrincipal(request, { roles: ["customer", "admin"], message: "Only customer or admin can request a refund." });
    return this.storefrontService.refundOrder(principal.email, orderId);
  }

  @Post("orders/:orderId/refund/status")
  @HttpCode(HttpStatus.OK)
  async refreshRefundStatus(@Req() request: FastifyRequest, @Param("orderId") orderId: string) {
    const principal = await requireRequestPrincipal(request, { roles: ["customer", "admin"], message: "Only customer or admin can view refund status." });
    return this.storefrontService.refreshRefundStatus(principal.email, orderId);
  }

  @Get("orders/me")
  async listMyOrders(@Req() request: FastifyRequest) {
    const principal = await requireRequestPrincipal(request, { message: "Only logged-in users can view their orders." });

    return this.storefrontService.listMyOrders(principal.email);
  }

  @Get("orders/:orderId/details")
  async getOrderDetails(@Req() request: FastifyRequest, @Param("orderId") orderId: string) {
    const principal = await requireRequestPrincipal(request, { message: "Sign in to view your order." });
    return this.storefrontService.getOrderDetails(principal.email, orderId);
  }
}
