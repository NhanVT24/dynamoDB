import type { RefundOrderRepository, OrderOperationLogger } from "../ports/order-lifecycle-ports.js";
import { OrderActionError } from "../order-action.error.js";
import { RefundResolution } from "../refund-resolution.js";

export class ReconcilePendingRefunds {
  constructor(private readonly orders: RefundOrderRepository, private readonly resolution: RefundResolution, private readonly log: OrderOperationLogger) {}

  async execute(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new OrderActionError("INVALID_INPUT", "Invalid reconciliation limit");
    const candidates = await this.orders.listPending(Math.min(limit, 100));
    let resolved = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        // GSI may lag a completed transition: re-read authoritative order state.
        const order = await this.orders.findById(candidate.id);
        if (!order || order.status !== "refund_pending" || !order.refundRequestId || !order.paymentTxnRef) continue;
        if ((await this.resolution.resolve(order)).changed) resolved++;
      } catch (error) {
        failed++;
        this.log.warn("refund.reconcile_failed", { orderId: candidate.id, requestId: candidate.refundRequestId, error });
      }
    }
    return { checked: candidates.length, resolved, failed };
  }
}
