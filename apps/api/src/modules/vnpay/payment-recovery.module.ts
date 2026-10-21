import { PaymentReviewAdministration } from "../storefront/application/payment-review-administration.js";
import { Logger, Module } from "@nestjs/common";
import { StorefrontModule } from "../storefront/storefront.module.js";
import { VnpayModule } from "./vnpay.module.js";
import { ConfigModule } from "../../config/config.module.js";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { CreateCheckout } from "../storefront/application/create-checkout/create-checkout.js";
import { DynamoPaymentReviews } from "../storefront/infrastructure/persistence/dynamo-payment-reviews.js";
import { PaymentProcessing } from "./application/payment-processing.js";
import { RecoverPayments } from "./application/recover-payments.js";
import { DynamoPaymentRecovery } from "./infrastructure/dynamo-payment-recovery.js";
import { VnpayStatusGateway } from "./infrastructure/vnpay-status-gateway.js";
import { ResumeCheckoutProvisioning } from "./infrastructure/checkout-provisioning.js";
import { PaymentRecoveryController } from "./payment-recovery.controller.js";

@Module({ imports: [StorefrontModule, VnpayModule, ConfigModule], controllers: [PaymentRecoveryController], providers: [{ provide: PaymentReviewAdministration, inject: [DynamoPaymentReviews], useFactory: (reviews: DynamoPaymentReviews) => new PaymentReviewAdministration(reviews) },
  { provide: DynamoPaymentReviews, useFactory: () => new DynamoPaymentReviews() },
  { provide: RecoverPayments, inject: [CreateCheckout, PaymentProcessing, RuntimeConfigService, DynamoPaymentReviews],
    useFactory: (checkout: CreateCheckout, processing: PaymentProcessing, config: RuntimeConfigService, reviews: DynamoPaymentReviews) => {
      const recovery = new DynamoPaymentRecovery();
      return new RecoverPayments(recovery, recovery, new VnpayStatusGateway(() => config.getPaymentConfig()), processing,
        new ResumeCheckoutProvisioning(checkout), reviews, { error: (event, details) => new Logger("PaymentRecovery").error({ event, ...details }) });
    } }
], exports: [RecoverPayments] })
export class PaymentRecoveryModule {}
