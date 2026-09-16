import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ForbiddenException
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { extractCognitoPrincipal, hasPermission } from "../../common/auth/cognito-principal.js";
import { ShoppingService } from "./shopping.service.js";
import {
  createShoppingItemSchema,
  updateShoppingItemSchema
} from "./shopping.schema.js";
import {
  shoppingIncrementBodySchema,
  shoppingListAllQuerySchema,
  shoppingListQuerySchema,
  shoppingPageCursorQuerySchema,
  shoppingParamsSchema,
  shoppingUpdateBodySchema
} from "./shopping.query-schemas.js";

@Controller("api/shopping-items")
export class ShoppingController {
  private readonly logger = new Logger(ShoppingController.name);

  constructor(private readonly shoppingService: ShoppingService) {}

  @Get("demo")
  listDemoShoppingItems() {
    return this.shoppingService.listDemoShoppingItems();
  }

  @Get("demo/:id")
  getDemoShoppingItemById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    const item = this.shoppingService.getDemoShoppingItemById(id);
    if (!item) throw new NotFoundException("Mock product not found");
    return item;
  }

  @Get("meta")
  getShoppingItemMetadata() {
    return this.shoppingService.getShoppingItemMetadata();
  }

  @Get()
  listShoppingItems(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    this.logger.log(`shopping list request ${JSON.stringify(query)}`);
    return this.shoppingService.listShoppingItems(query);
  }

  @Get("all")
  listAllShoppingItems(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingListAllQuerySchema.parse(rawQuery);
    this.logger.log(`shopping all request ${JSON.stringify(query)}`);
    return this.shoppingService.listAllShoppingItems(query);
  }

  @Get("page-cursor")
  getShoppingItemsPageCursor(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingPageCursorQuerySchema.parse(rawQuery);
    this.logger.log(`shopping page-cursor request ${JSON.stringify(query)}`);
    return this.shoppingService.getShoppingItemsPageCursor(query);
  }

  @Get("mine")
  async listMyShoppingItems(@Req() request: FastifyRequest) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal) throw new ForbiddenException("A signed-in account is required.");
    return this.shoppingService.listOwnedShoppingItems(principal.subject);
  }

  @Get(":id")
  async getShoppingItemById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    const item = await this.shoppingService.getShoppingItemById(id);
    if (!item) throw new NotFoundException("Product not found");
    return item;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createShoppingItem(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || !hasPermission(principal, "products:create")) {
      throw new ForbiddenException("Missing permission: products:create");
    }
    const input = createShoppingItemSchema.parse(rawBody);
    return this.shoppingService.createShoppingItem(input, principal.subject);
  }

  @Patch(":id")
  async updateShoppingItem(@Req() request: FastifyRequest, @Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || !hasPermission(principal, "products:update-own")) {
      throw new ForbiddenException("Missing permission: products:update-own");
    }
    const { id } = shoppingParamsSchema.parse(params);
    const body = updateShoppingItemSchema.merge(shoppingUpdateBodySchema).parse(rawBody);
    const { version, ...patch } = body;
    return this.shoppingService.updateShoppingItem(id, patch, version, principal);
  }

  @Patch(":id/increment")
  async incrementShoppingItemField(@Req() request: FastifyRequest, @Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || !hasPermission(principal, "products:update-own")) {
      throw new ForbiddenException("Missing permission: products:update-own");
    }
    const { id } = shoppingParamsSchema.parse(params);
    const body = shoppingIncrementBodySchema.parse(rawBody);
    return this.shoppingService.incrementShoppingItemField(id, body.field, body.incrementBy, principal);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteShoppingItem(@Req() request: FastifyRequest, @Param() params: Record<string, string>) {
    const principal = await extractCognitoPrincipal(request.headers as Record<string, unknown>);
    if (!principal || !hasPermission(principal, "products:delete-own")) {
      throw new ForbiddenException("Missing permission: products:delete-own");
    }
    const { id } = shoppingParamsSchema.parse(params);
    await this.shoppingService.deleteShoppingItem(id, principal);
  }
}
