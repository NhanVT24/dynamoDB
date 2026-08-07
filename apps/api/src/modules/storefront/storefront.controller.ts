import { Body, Controller, ForbiddenException, Get, Logger, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { StorefrontService } from "./storefront.service.js";
import { createStorefrontOrderSchema } from "./storefront.schema.js";

@Controller("api/storefront")
export class StorefrontController {
  private readonly logger = new Logger(StorefrontController.name);

  constructor(private readonly storefrontService: StorefrontService) {}

  @Get("products")
  listProducts(@Query() rawQuery: Record<string, unknown>) {
    this.logger.log(`storefront products request ${JSON.stringify(rawQuery)}`);
    return this.storefrontService.listProducts(rawQuery);
  }

  @Get("products/:id")
  getProductById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    return this.storefrontService.getProductById(id);
  }

  @Post("orders")
  createOrder(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("Chỉ tài khoản customer hoặc admin mới được tạo đơn hàng.");
    }

    const input = createStorefrontOrderSchema.parse(rawBody);
    return this.storefrontService.createOrder(principal.email, input);
  }

  @Get("orders/me")
  listMyOrders(@Req() request: FastifyRequest) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) {
      throw new ForbiddenException("Bạn cần đăng nhập để xem đơn hàng.");
    }

    return this.storefrontService.listMyOrders(principal.email);
  }
}
