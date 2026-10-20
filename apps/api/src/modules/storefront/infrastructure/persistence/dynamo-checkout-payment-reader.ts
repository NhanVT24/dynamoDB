import type { CheckoutPaymentReader } from "../../application/workflow-checkout/workflow-checkout.js";
import { getAwaitingPaymentOrder } from "./order-record.store.js";
import { getPaymentSessionByTxnRef } from "../../../vnpay/vnpay.repository.js";

export class DynamoCheckoutPaymentReader implements CheckoutPaymentReader {
  async find(orderId: string) {
    const order = await getAwaitingPaymentOrder(orderId);
    if (!order?.paymentTxnRef || !order.paymentUrl || order.status !== "awaiting_payment" || order.lockedUntil <= new Date().toISOString()) return null;
    const payment = await getPaymentSessionByTxnRef(order.paymentTxnRef);
    if (!payment || payment.orderId !== orderId || payment.email !== order.customerEmail || payment.amount !== order.totalAmount) return null;
    return { customerEmail: order.customerEmail, paymentUrl: order.paymentUrl, txnRef: payment.txnRef,
      amount: payment.amount, orderInfo: payment.orderInfo, expiresAt: payment.expiresAt };
  }
}
