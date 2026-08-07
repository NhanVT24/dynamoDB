import { Module } from "@nestjs/common";
import { ProductsPublicController } from "./products-public.controller.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontService } from "./storefront.service.js";

@Module({
  controllers: [StorefrontController, ProductsPublicController],
  providers: [StorefrontService]
})
export class StorefrontModule {}
