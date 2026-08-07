import { Controller, Get, Param, Query } from "@nestjs/common";
import { shoppingParamsSchema } from "../shopping/shopping.query-schemas.js";
import { StorefrontService } from "./storefront.service.js";

@Controller("api/products")
export class ProductsPublicController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get()
  listProducts(@Query() rawQuery: Record<string, unknown>) {
    return this.storefrontService.listProducts(rawQuery);
  }

  @Get(":id")
  getProductById(@Param() params: Record<string, string>) {
    const { id } = shoppingParamsSchema.parse(params);
    return this.storefrontService.getProductById(id);
  }
}
