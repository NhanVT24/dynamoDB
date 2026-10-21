import type { CheckoutProvisioning } from "../application/ports/payment-recovery-ports.js";
import type { CreateCheckout } from "../../storefront/application/create-checkout/create-checkout.js";
import { getAwaitingPaymentOrder, listOrderItems } from "../../storefront/infrastructure/persistence/order-record.store.js";

export class ResumeCheckoutProvisioning implements CheckoutProvisioning {
  constructor(private readonly checkout: CreateCheckout) {}
  async resume(orderId: string) {
    const order = await getAwaitingPaymentOrder(orderId);
    if (!order || order.status !== "awaiting_payment" || order.paymentTxnRef || order.lockedUntil <= new Date().toISOString()) return;
    const items = await listOrderItems(orderId);
    await this.checkout.execute(order.customerEmail, { requestId: orderId, items: items.map(({ productId, quantity }) => ({ productId, quantity })),
      bankCode: order.checkoutBankCode, locale: order.checkoutLocale });
  }
}
