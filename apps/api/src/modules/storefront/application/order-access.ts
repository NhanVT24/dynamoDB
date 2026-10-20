import type { RefundOrder } from "../domain/order-refund.js";
import { OrderActionError } from "./order-action.error.js";

export function assertOwnedOrder(order: RefundOrder | null, email: string): asserts order is RefundOrder {
  // Preserve not-found for another customer's order; do not disclose its existence.
  if (!order || order.customerEmail !== email) throw new OrderActionError("NOT_FOUND", "Order not found.");
}
