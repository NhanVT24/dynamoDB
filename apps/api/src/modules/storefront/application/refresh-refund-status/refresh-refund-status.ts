import { refundResponse } from "../../domain/order-refund.js";
import type { RefundOrderRepository } from "../ports/order-lifecycle-ports.js";
import { assertOwnedOrder } from "../order-access.js";
import { OrderActionError } from "../order-action.error.js";
import { RefundResolution } from "../refund-resolution.js";

export class RefreshRefundStatus {
  constructor(private readonly orders: RefundOrderRepository, private readonly resolution: RefundResolution) {}

  async execute(email: string, orderId: string) {
    const order = await this.orders.findById(orderId);
    assertOwnedOrder(order, email);
    if (!order.refundRequestId || !order.paymentTxnRef) throw new OrderActionError("CONFLICT", "No refund request for this order.");
    try {
      return refundResponse((await this.resolution.resolve(order)).order);
    } catch (error) {
      if (error instanceof OrderActionError) throw error;
      // Preserve pending/current status on a failed provider query or persistence.
      return refundResponse(await this.orders.findById(orderId) ?? order);
    }
  }
}
