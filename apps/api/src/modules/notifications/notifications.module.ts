import { Logger } from "@nestjs/common";
import { notificationEffects, notificationConfig } from "./infrastructure/notification-effects.js";
import { CompleteNotifiedOrder } from "./application/complete-notified-order.js";
import { DynamoNotifiedOrders } from "./infrastructure/dynamo-notified-orders.js";
import { DynamoPaymentReviews } from "../storefront/infrastructure/persistence/dynamo-payment-reviews.js";
import { DurableSettledPayments } from "../vnpay/infrastructure/settled-payment-reader.js";
import { ConfirmOrderPayment } from "../storefront/application/confirm-order-payment/confirm-order-payment.js";
import { DynamoCheckoutOrders } from "../storefront/infrastructure/persistence/dynamo-checkout-orders.js";
import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [NotificationsController],
  providers: [{ provide: NotificationsService, inject: [ConfirmOrderPayment, CompleteNotifiedOrder],
      useFactory: (confirm: ConfirmOrderPayment, complete: CompleteNotifiedOrder) => new NotificationsService(confirm, complete, notificationEffects, notificationConfig(), new Logger(NotificationsService.name)) },
    { provide: CompleteNotifiedOrder, useFactory: () => new CompleteNotifiedOrder(new DynamoNotifiedOrders()) }, { provide: ConfirmOrderPayment, useFactory: () => new ConfirmOrderPayment(new DynamoCheckoutOrders(), new DurableSettledPayments(), new DynamoPaymentReviews()) }],
  exports: [NotificationsService]
})
export class NotificationsModule {}
