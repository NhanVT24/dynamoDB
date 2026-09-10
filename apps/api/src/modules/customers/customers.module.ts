import { Module } from "@nestjs/common"; import { CustomersController } from "./customers.controller.js";
@Module({ controllers: [CustomersController] }) export class CustomersModule {}
