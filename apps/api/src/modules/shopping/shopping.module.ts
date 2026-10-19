import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { UpdateProduct } from "./application/update-product/update-product.js";
import { DynamoProductWriteRepository } from "./infrastructure/persistence/dynamo-product-write-repository.js";
import { NotificationsInventoryAlertPublisher } from "./infrastructure/notifications/inventory-alert-publisher.js";
import { ShoppingController } from "./shopping.controller.js";
import { ShoppingService } from "./shopping.service.js";

@Module({
  imports: [NotificationsModule],
  controllers: [ShoppingController],
  providers: [
    ShoppingService,
    {
      provide: UpdateProduct,
      inject: [NotificationsService],
      useFactory: (notifications: NotificationsService) => new UpdateProduct(
        new DynamoProductWriteRepository(),
        new NotificationsInventoryAlertPublisher(notifications)
      )
    }
  ]
})
export class ShoppingModule {}
