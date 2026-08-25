import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Logger, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { extractCognitoPrincipal } from "../../common/auth/cognito-principal.js";
import { StorefrontService } from "./storefront.service.js";
import { cancelStorefrontCheckoutSchema, createCheckoutPaymentSessionSchema, createStorefrontOrderSchema, prepareStorefrontCheckoutSchema } from "./storefront.schema.js";

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
  @HttpCode(HttpStatus.ACCEPTED)
  createOrder(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    this.logger.log(`[storefront-controller] create_order_request url=${request.url} hasAuth=${Boolean(request.headers.authorization)} bodyKeys=${Object.keys(rawBody ?? {}).join(",")}`);
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    this.logger.log(`[storefront-controller] create_order_principal_resolved url=${request.url} hasPrincipal=${Boolean(principal)} role=${principal?.role ?? "none"}`);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("Chỉ tài khoản customer hoặc admin mới được tạo đơn hàng.");
    }

    const input = createStorefrontOrderSchema.parse(rawBody);
    this.logger.log(`[storefront-controller] create_order_validated email=${principal?.email ?? "unknown"} itemCount=${input.items.length}`);
    return this.storefrontService.createOrder(principal.email, input);
  }

  @Post("checkout/prepare")
  @HttpCode(HttpStatus.ACCEPTED)
  prepareCheckout(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("Chỉ tài khoản customer hoặc admin mới được bắt đầu checkout.");
    }

    const input = prepareStorefrontCheckoutSchema.parse(rawBody);
    return this.storefrontService.prepareCheckout(principal.email, input);
  }

  @Get("checkout/prepare/:requestId")
  async getCheckoutStatus(@Req() request: FastifyRequest, @Param("requestId") requestId: string) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("Bạn cần đăng nhập để xem trạng thái checkout.");
    }

    const status = await this.storefrontService.getCheckoutGateStatus(principal.email, requestId);
    this.logger.log(`[checkout-gate] status_read requestId=${requestId} status=${status.status} customer=${principal.email}`);
    return status;
  }

  @Post("checkout/payment-session")
  @HttpCode(HttpStatus.OK)
  createCheckoutPaymentSession(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("only customer or admin can create checkout payment session.");
    }

    const input = createCheckoutPaymentSessionSchema.parse(rawBody);
    return this.storefrontService.createCheckoutPaymentSession(principal.email, input.requestId, request.ip);
  }

  @Post("checkout/cancel")
  @HttpCode(HttpStatus.OK)
  cancelCheckout(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || (principal.role !== "customer" && principal.role !== "admin")) {
      throw new ForbiddenException("Chỉ tài khoản customer hoặc admin mới được hủy lượt checkout.");
    }

    const input = cancelStorefrontCheckoutSchema.parse(rawBody);
    return this.storefrontService.cancelCheckout(principal.email, input.requestId);
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
