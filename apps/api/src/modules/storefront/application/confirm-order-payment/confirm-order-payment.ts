import type { CheckoutOrders, SettledPayments } from "../ports/checkout-ports.js";

export class ConfirmOrderPayment {
  constructor(private readonly orders: CheckoutOrders, private readonly payments: SettledPayments) {}
  async execute(input: { orderId: string; email: string; amount: number; txnRef: string }) {
    const payment = await this.payments.find(input.txnRef);
    if (!payment || payment.status !== "success" || payment.orderId !== input.orderId ||
      payment.email !== input.email || payment.amount !== input.amount) {
      throw new Error("Payment success is not durable; reconciliation required");
    }
    const order = await this.orders.findById(input.orderId);
    if (!order || order.customerEmail !== input.email || order.totalAmount !== input.amount ||
      order.paymentTxnRef !== input.txnRef) {
      throw new Error("Payment does not match held order; reconciliation required");
    }
    return this.orders.transition({ orderId: input.orderId, expectedCustomerEmail: input.email,
      expectedAmount: input.amount, expectedPaymentTxnRef: input.txnRef, status: "paid", paymentConfirmedAt: payment.paymentConfirmedAt });
  }
}
