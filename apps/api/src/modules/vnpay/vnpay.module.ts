import { ReadPaymentReturn } from "./application/read-payment-return.js";
import { CreatePayment } from "./application/create-payment.js";
import { VnpayPaymentLinkIssuer } from "./infrastructure/vnpay-payment-link-issuer.js";
import { readProductRecord } from "../shopping/infrastructure/persistence/product-record.store.js";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { PaymentProcessing } from "./application/payment-processing.js";
import { DynamoPaymentSessions } from "./infrastructure/dynamo-payment-sessions.js";
import { NotificationPaymentEvents } from "./infrastructure/notification-payment-events.js";
import { DynamoFailedPaymentOrders } from "./infrastructure/failed-payment-orders.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { Logger } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { VnpayController } from "./vnpay.controller.js";
import { VnpayService } from "./vnpay.service.js";

@Module({
  imports: [ConfigModule, NotificationsModule],
  controllers: [VnpayController],
  providers: [VnpayService, { provide: ReadPaymentReturn, useFactory: () => new ReadPaymentReturn(new DynamoPaymentSessions()) }, { provide: CreatePayment, inject: [RuntimeConfigService],
    useFactory: (config: RuntimeConfigService) => new CreatePayment({ find: readProductRecord }, new VnpayPaymentLinkIssuer(() => config.getPaymentConfig())) }, { provide: PaymentProcessing, inject: [NotificationsService],
    useFactory: (notifications: NotificationsService) => new PaymentProcessing(new DynamoPaymentSessions(),
      new NotificationPaymentEvents(notifications), new DynamoFailedPaymentOrders(),
      { error: (event, details) => new Logger("PaymentProcessing").error({ event, ...details }) }) }],
  exports: [VnpayService, PaymentProcessing]
})
export class VnpayModule {}
