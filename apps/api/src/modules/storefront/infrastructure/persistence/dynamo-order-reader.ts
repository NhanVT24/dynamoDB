import type { OrderLineView, OrderReader, OrderSummary, OrderView } from "../../application/ports/order-reader.js";
import { getOrderById, getAwaitingPaymentOrder, listOrderItems, listOrdersByCustomer } from "./storefront.store.js";

function line(row: Record<string, unknown>): OrderLineView {
  return { productId: String(row.productId ?? ""), productName: String(row.productName ?? ""),
    price: Number(row.price ?? row.unitPrice ?? 0), originalUnitPrice: row.originalUnitPrice == null ? undefined : Number(row.originalUnitPrice),
    quantity: Number(row.quantity ?? 0), lineTotal: Number(row.lineTotal ?? 0) };
}
function header(id: string, row: Record<string, unknown>): Omit<OrderView, "items"> {
  return { id, customerEmail: String(row.customerEmail ?? ""), status: String(row.status ?? ""),
    totalAmount: Number(row.totalAmount ?? 0), createdAt: String(row.createdAt ?? ""), updatedAt: String(row.updatedAt ?? ""),
    paymentConfirmedAt: row.paymentConfirmedAt as string | undefined,
    refundStatus: row.refundStatus as string | undefined, refundUpdatedAt: row.refundUpdatedAt as string | undefined };
}
export class DynamoOrderReader implements OrderReader {
  async findLegacy(id: string) {
    const row = await getOrderById(id);
    return row ? { ...header(id, row), items: row.items.map(line) } : null;
  }
  async findCheckout(id: string) {
    const row = await getAwaitingPaymentOrder(id);
    return row ? header(id, row) : null;
  }
  async listItems(id: string) { return (await listOrderItems(id)).map(line); }
  async listByCustomer(email: string): Promise<OrderSummary[]> {
    return (await listOrdersByCustomer(email)).map(row => ({ ...header(String(row.id), row),
      items: (row.items ?? []).map(line), lockedUntil: row.lockedUntil, paymentTxnRef: row.paymentTxnRef,
      paymentUrl: row.paymentUrl, itemCount: row.itemCount, refundRequestId: row.refundRequestId,
      refundTransactionNo: row.refundTransactionNo }));
  }
}
