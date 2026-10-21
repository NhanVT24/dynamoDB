import { DynamoPaymentReviews } from "../storefront/infrastructure/persistence/dynamo-payment-reviews.js";
import { DurableSettledPayments } from "../vnpay/infrastructure/settled-payment-reader.js";
import { ConfirmOrderPayment } from "../storefront/application/confirm-order-payment/confirm-order-payment.js";
import { DynamoCheckoutOrders } from "../storefront/infrastructure/persistence/dynamo-checkout-orders.js";
import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: ConfirmOrderPayment, useFactory: () => new ConfirmOrderPayment(new DynamoCheckoutOrders(), new DurableSettledPayments(), new DynamoPaymentReviews()) }],
  exports: [NotificationsService]
})
export class NotificationsModule {}
