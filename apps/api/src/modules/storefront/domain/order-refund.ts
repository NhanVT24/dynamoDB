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

export const REFUND_WINDOW_MS = 5 * 60 * 1000;

export function isRefundEligible(order: RefundOrder, now: number): boolean {
  const paidAt = order.paymentConfirmedAt ? Date.parse(order.paymentConfirmedAt) : NaN;
  return order.status === "paid" && Boolean(order.paymentTxnRef) && Number.isFinite(paidAt)
    && now < paidAt + REFUND_WINDOW_MS;
}

export function isTerminalRefund(status: OrderLifecycleStatus): status is "refund_sent" | "refund_rejected" {
  return status === "refund_sent" || status === "refund_rejected";
}

export function refundResponse(order: RefundOrder) {
  return { orderId: order.id, status: order.status, refundStatus: order.refundStatus };
}
