import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { requireRequestPrincipal } from "../../common/auth/request-principal.js";
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
  async listShoppingItems(@Req() request: FastifyRequest, @Query() rawQuery: Record<string, unknown>) {
    await this.requireAdminRead(request);
    const query = shoppingListQuerySchema.parse(rawQuery);
    return this.shoppingService.listShoppingItems(query);
  }

  @Get("all")
  async listAllShoppingItems(@Req() request: FastifyRequest, @Query() rawQuery: Record<string, unknown>) {
    await this.requireAdminRead(request);
    const query = shoppingListAllQuerySchema.parse(rawQuery);
    return this.shoppingService.listAllShoppingItems(query);
  }

  @Get("page-cursor")
  async getShoppingItemsPageCursor(@Req() request: FastifyRequest, @Query() rawQuery: Record<string, unknown>) {
    await this.requireAdminRead(request);
    const query = shoppingPageCursorQuerySchema.parse(rawQuery);
    return this.shoppingService.getShoppingItemsPageCursor(query);
  }

  @Get("mine")
  async listMyShoppingItems(@Req() request: FastifyRequest) {
    const principal = await requireRequestPrincipal(request, { message: "A signed-in account is required." });
    return this.shoppingService.listOwnedShoppingItems(principal.subject);
  }

  @Get(":id")
  async getShoppingItemById(@Req() request: FastifyRequest, @Param() params: Record<string, string>) {
    await this.requireAdminRead(request);
    const { id } = shoppingParamsSchema.parse(params);
    const item = await this.shoppingService.getShoppingItemById(id);
    if (!item) throw new NotFoundException("Product not found");
    return item;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createShoppingItem(@Req() request: FastifyRequest, @Body() rawBody: Record<string, unknown>) {
    const principal = await requireRequestPrincipal(request, { permission: "products:create", message: "Missing permission: products:create" });
    const input = createShoppingItemSchema.parse(rawBody);
    // The preprocess schema requires category at runtime; make its presence
    // explicit for Zod's inferred type under the project's strict:false config.
    return this.shoppingService.createShoppingItem({ ...input, category: input.category }, principal);
  }

  @Patch(":id")
  async updateShoppingItem(@Req() request: FastifyRequest, @Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const principal = await requireRequestPrincipal(request, { permission: "products:update-own", message: "Missing permission: products:update-own" });
    const { id } = shoppingParamsSchema.parse(params);
    const body = updateShoppingItemSchema.merge(shoppingUpdateBodySchema).parse(rawBody);
    const { version, ...patch } = body;
    return this.shoppingService.updateShoppingItem(id, patch, version, principal);
  }

  @Patch(":id/increment")
  async incrementShoppingItemField(@Req() request: FastifyRequest, @Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const principal = await requireRequestPrincipal(request, { permission: "products:update-own", message: "Missing permission: products:update-own" });
    const { id } = shoppingParamsSchema.parse(params);
    const body = shoppingIncrementBodySchema.parse(rawBody);
    return this.shoppingService.incrementShoppingItemField(id, body.field, body.incrementBy, principal);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteShoppingItem(@Req() request: FastifyRequest, @Param() params: Record<string, string>) {
    const principal = await requireRequestPrincipal(request, { permission: "products:delete-own", message: "Missing permission: products:delete-own" });
    const { id } = shoppingParamsSchema.parse(params);
    await this.shoppingService.deleteShoppingItem(id, principal);
  }

  private requireAdminRead(request: FastifyRequest) {
    return requireRequestPrincipal(request, { roles: ["admin"], message: "Only admin accounts can read product management records." });
  }
}
