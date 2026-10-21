import type { CheckoutOrders, SettledPayments } from "../ports/checkout-ports.js";
import { PaymentReviewRequired, type PaymentReviewWriter } from "../ports/payment-review.js";

export class ConfirmOrderPayment {
  constructor(private readonly orders: CheckoutOrders, private readonly payments: SettledPayments,
    private readonly reviews: PaymentReviewWriter) {}
  async execute(input: { orderId: string; email: string; amount: number; txnRef: string }) {
    const payment = await this.payments.find(input.txnRef);
    if (!payment || payment.status !== "success" || payment.orderId !== input.orderId ||
      payment.email !== input.email || payment.amount !== input.amount) {
      throw new Error("Payment success is not durable; reconciliation required");
    }
    const order = await this.orders.findById(input.orderId);
    if (!order || order.customerEmail !== input.email || order.totalAmount !== input.amount ||
      order.paymentTxnRef !== input.txnRef) {
      await this.reviews.open({ txnRef: input.txnRef, orderId: input.orderId, amount: input.amount, reason: "CORRELATION_MISMATCH" });
      throw new PaymentReviewRequired(input.txnRef);
    }
    const recordIfReleased = async () => {
      const current = await this.orders.findById(input.orderId);
      if (current && ["expired", "cancelled", "payment_failed"].includes(current.status)) {
        await this.reviews.open({ txnRef: input.txnRef, orderId: input.orderId, amount: input.amount, reason: "PAID_AFTER_RELEASE" });
        throw new PaymentReviewRequired(input.txnRef);
      }
    };
    await recordIfReleased();
    try {
      return await this.orders.transition({ orderId: input.orderId, expectedCustomerEmail: input.email,
        expectedAmount: input.amount, expectedPaymentTxnRef: input.txnRef, status: "paid", paymentConfirmedAt: payment.paymentConfirmedAt });
    } catch (error) { await recordIfReleased(); throw error; }
  }
}
