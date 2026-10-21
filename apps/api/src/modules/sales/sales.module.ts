import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";
import { createSalesService } from "./sales.composition.js";
@Module({ controllers: [SalesController], providers: [{ provide: SalesService,
 useFactory: createSalesService }], exports: [SalesService] })
export class SalesModule {}
