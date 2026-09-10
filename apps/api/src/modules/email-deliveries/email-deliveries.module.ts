import { Module } from "@nestjs/common";
import { EmailDeliveriesController } from "./email-deliveries.controller.js";

@Module({ controllers: [EmailDeliveriesController] })
export class EmailDeliveriesModule {}
