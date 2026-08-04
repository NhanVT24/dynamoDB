import { Module } from "@nestjs/common";
import { ShoppingController } from "./shopping.controller.js";
import { ShoppingService } from "./shopping.service.js";

@Module({
  controllers: [ShoppingController],
  providers: [ShoppingService]
})
export class ShoppingModule {}
