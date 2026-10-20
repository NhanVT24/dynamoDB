import type { CheckoutItem } from "../../domain/checkout.js";
import { OrderActionError } from "../order-action.error.js";

export interface QueuedOrder {
  id: string; customerEmail: string; status: "pending" | "done"; totalAmount: number; createdAt: string;
  items: Array<CheckoutItem & { productName: string; price: number; originalUnitPrice?: number; lineTotal: number }>;
}
export interface OrderStockChange {
  productId: string; productName: string; sku?: string; previousStock: number; stock: number;
  previousStatus: string; status: string;
}
export interface OrderFinalizationRepository {
  /** requestId is the durable deduplication identity, including concurrent retries. */
  commit(email: string, items: CheckoutItem[], requestId: string): Promise<{ order: QueuedOrder; stockChanges: OrderStockChange[] }>;
}
export interface OrderFinalizationEffects {
  succeeded(order: QueuedOrder, stockChanges: OrderStockChange[], requestId: string): Promise<void>;
  failed(email: string, items: CheckoutItem[], requestId: string, failureReason: string): Promise<void>;
}
export class InsufficientOrderStock extends OrderActionError {
  constructor(message: string) { super("CONFLICT", message); this.name = "InsufficientOrderStock"; }
}
