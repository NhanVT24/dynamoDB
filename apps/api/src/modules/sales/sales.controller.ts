import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { createSaleCampaignSchema } from "./sales.schema.js";
import { SalesService } from "./sales.service.js";
@Controller("api/sales") export class SalesController {
  constructor(private readonly salesService: SalesService) {}
  @Get() list() { return this.salesService.list(); }
  @Get(":id/products") listProducts(@Param("id") id: string) { return this.salesService.listProducts(id); }
  @Post() create(@Body() body: Record<string, unknown>) { return this.salesService.create(createSaleCampaignSchema.parse(body)); }
  @Post(":id/products/:productId/remove") removeProduct(@Param("id") id: string, @Param("productId") productId: string) { return this.salesService.removeProduct(id, productId); }
  @Post(":id/cancel") cancel(@Param("id") id: string) { return this.salesService.cancel(id); }
}
