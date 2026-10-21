import { WorkflowCheckout, ReadWorkflowPayment } from "./application/workflow-checkout/workflow-checkout.js";
import { DynamoCheckoutPaymentReader } from "./infrastructure/persistence/dynamo-checkout-payment-reader.js";
import { GetCheckoutStatus } from "./application/get-checkout-status/get-checkout-status.js";
import { FinalizeOrder } from "./application/finalize-order/finalize-order.js";
import { DynamoOrderFinalization } from "./infrastructure/persistence/dynamo-order-finalization.js";
import { NotificationOrderFinalizationEffects } from "./infrastructure/notifications/order-finalization-effects.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { CreateCheckout } from "./application/create-checkout/create-checkout.js";
import { ExpireOrders } from "./application/expire-orders/expire-orders.js";
import { DynamoCheckoutOrders } from "./infrastructure/persistence/dynamo-checkout-orders.js";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { VnpayModule } from "../vnpay/vnpay.module.js";
import { ProductsPublicController } from "./products-public.controller.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontService } from "./storefront.service.js";
import { VnpayService } from "../vnpay/vnpay.service.js";
import { CancelOrder } from "./application/cancel-order/cancel-order.js";
import { RequestRefund } from "./application/request-refund/request-refund.js";
import { RefreshRefundStatus } from "./application/refresh-refund-status/refresh-refund-status.js";
import { ReconcilePendingRefunds } from "./application/reconcile-pending-refunds/reconcile-pending-refunds.js";
import { RefundResolution } from "./application/refund-resolution.js";
import { DynamoRefundOrders } from "./infrastructure/persistence/dynamo-refund-orders.js";
import { DynamoOrderCancellation } from "./infrastructure/persistence/dynamo-order-cancellation.js";
import { VnpayRefundGateway } from "./infrastructure/payments/vnpay-refund-gateway.js";
import { RefundEmailNotifier } from "./infrastructure/notifications/refund-email-notifier.js";
import { NestOrderOperationLogger } from "./infrastructure/order-operation-logger.js";

@Module({
  controllers: [StorefrontController, ProductsPublicController],
  imports: [NotificationsModule, VnpayModule],
  providers: [
    StorefrontService,
    { provide: WorkflowCheckout, inject: [CreateCheckout, NotificationsService],
      useFactory: (checkout: CreateCheckout, notifications: NotificationsService) => new WorkflowCheckout(checkout, new NotificationOrderFinalizationEffects(notifications)) },
    { provide: ReadWorkflowPayment, useFactory: () => new ReadWorkflowPayment(new DynamoCheckoutPaymentReader()) },
    { provide: GetCheckoutStatus, useFactory: () => new GetCheckoutStatus(new DynamoCheckoutOrders()) },
    { provide: FinalizeOrder, inject: [NotificationsService],
      useFactory: (notifications: NotificationsService) => new FinalizeOrder(new DynamoOrderFinalization(), new NotificationOrderFinalizationEffects(notifications)) },
    { provide: CreateCheckout, inject: [VnpayService, NestOrderOperationLogger],
      useFactory: (vnpay: VnpayService, log: NestOrderOperationLogger) => new CreateCheckout(new DynamoCheckoutOrders(),
        { create: input => vnpay.createWorkflowPaymentUrl(input) }, log, randomUUID) },
    { provide: ExpireOrders, inject: [NestOrderOperationLogger],
      useFactory: (log: NestOrderOperationLogger) => new ExpireOrders(new DynamoCheckoutOrders(), log) },
    { provide: DynamoRefundOrders, useFactory: () => new DynamoRefundOrders() },
    { provide: NestOrderOperationLogger, useFactory: () => new NestOrderOperationLogger() },
    { provide: RefundEmailNotifier, useFactory: () => new RefundEmailNotifier() },
    { provide: VnpayRefundGateway, inject: [VnpayService],
      useFactory: (vnpay: VnpayService) => new VnpayRefundGateway(() => vnpay.getPaymentConfig()) },
    { provide: RefundResolution, inject: [DynamoRefundOrders, VnpayRefundGateway, RefundEmailNotifier, NestOrderOperationLogger],
      useFactory: (orders: DynamoRefundOrders, gateway: VnpayRefundGateway, notifier: RefundEmailNotifier, log: NestOrderOperationLogger) =>
        new RefundResolution(orders, gateway, notifier, log) },
    { provide: CancelOrder, useFactory: () => new CancelOrder(new DynamoOrderCancellation()) },
    { provide: RequestRefund, inject: [DynamoRefundOrders, VnpayRefundGateway, RefundResolution, NestOrderOperationLogger],
      useFactory: (orders: DynamoRefundOrders, gateway: VnpayRefundGateway, resolution: RefundResolution, log: NestOrderOperationLogger) =>
        new RequestRefund(orders, gateway, resolution, log, () => randomBytes(16).toString("hex"), Date.now) },
    { provide: RefreshRefundStatus, inject: [DynamoRefundOrders, RefundResolution],
      useFactory: (orders: DynamoRefundOrders, resolution: RefundResolution) => new RefreshRefundStatus(orders, resolution) },
    { provide: ReconcilePendingRefunds, inject: [DynamoRefundOrders, RefundResolution, NestOrderOperationLogger],
      useFactory: (orders: DynamoRefundOrders, resolution: RefundResolution, log: NestOrderOperationLogger) =>
        new ReconcilePendingRefunds(orders, resolution, log) }
  ],
  exports: [CreateCheckout, ReconcilePendingRefunds, ExpireOrders, WorkflowCheckout, ReadWorkflowPayment]
})
export class StorefrontModule {}
