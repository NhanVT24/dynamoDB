import { Order } from "./order.js";
export type OrderLifecycleStatus = "awaiting_payment" | "paid" | "cancelled" | "expired" | "payment_failed"
  | "refund_pending" | "refund_sent" | "refund_rejected";
export type RefundStatus = Extract<OrderLifecycleStatus, "refund_pending" | "refund_sent" | "refund_rejected">;

export interface RefundOrder {
  id: string;
  customerEmail: string;
  status: OrderLifecycleStatus;
  totalAmount: number;
  paymentTxnRef?: string;
  paymentConfirmedAt?: string;
  refundRequestId?: string;
  refundStatus?: string;
  refundTransactionNo?: string;
}

export interface RefundPayment {
  reference: string;
  amount: number;
  status: "pending" | "success" | "failed" | "expired";
  orderId?: string;
}

export { REFUND_WINDOW_MS } from "./order.js";

export function isRefundEligible(order: RefundOrder, now: number): boolean {
  return new Order(order).isRefundEligibleAt(now);
}

export function isTerminalRefund(status: OrderLifecycleStatus): status is "refund_sent" | "refund_rejected" {
  return Order.isTerminalRefundStatus(status);
}

export function refundResponse(order: RefundOrder) {
  return new Order(order).refundResponse();
}
