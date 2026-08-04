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
  Query
} from "@nestjs/common";
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
  getDemo() {
    return this.shoppingService.listMockItems();
  }

  @Get("demo/:id")
  getDemoItem(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    const item = this.shoppingService.getMockItem(id);
    if (!item) throw new NotFoundException("Mock product not found");
    return item;
  }

  @Get("meta")
  getMeta() {
    return this.shoppingService.getMeta();
  }

  @Get()
  list(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    this.logger.log(`shopping list request ${JSON.stringify(query)}`);
    return this.shoppingService.list(query);
  }

  @Get("all")
  listAll(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingListAllQuerySchema.parse(rawQuery);
    this.logger.log(`shopping all request ${JSON.stringify(query)}`);
    return this.shoppingService.listAll(query);
  }

  @Get("page-cursor")
  getPageCursor(@Query() rawQuery: Record<string, unknown>) {
    const query = shoppingPageCursorQuerySchema.parse(rawQuery);
    this.logger.log(`shopping page-cursor request ${JSON.stringify(query)}`);
    return this.shoppingService.getPageCursor(query);
  }

  @Get(":id")
  async getById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    const item = await this.shoppingService.getById(id);
    if (!item) throw new NotFoundException("Product not found");
    return item;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() rawBody: Record<string, unknown>) {
    const input = createShoppingItemSchema.parse(rawBody);
    return this.shoppingService.create(input);
  }

  @Patch(":id")
  update(@Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const { id } = shoppingParamsSchema.parse(params);
    const body = updateShoppingItemSchema.merge(shoppingUpdateBodySchema).parse(rawBody);
    const { version, ...patch } = body;
    return this.shoppingService.update(id, patch, version);
  }

  @Patch(":id/increment")
  increment(@Param() params: Record<string, string>, @Body() rawBody: Record<string, unknown>) {
    const { id } = shoppingParamsSchema.parse(params);
    const body = shoppingIncrementBodySchema.parse(rawBody);
    return this.shoppingService.increment(id, body.field, body.incrementBy);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    await this.shoppingService.remove(id);
  }
}
