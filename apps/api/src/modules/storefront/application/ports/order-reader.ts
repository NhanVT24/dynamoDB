export interface OrderLineView {
  productId: string; productName: string; price: number; originalUnitPrice?: number; quantity: number; lineTotal: number;
}
export interface OrderView {
  id: string; customerEmail: string; status: string; totalAmount: number;
  createdAt: string; updatedAt: string; items: OrderLineView[];
  paymentConfirmedAt?: string; refundStatus?: string; refundUpdatedAt?: string;
}
export interface OrderSummary extends OrderView {
  lockedUntil?: string; paymentTxnRef?: string; paymentUrl?: string; itemCount?: number;
  refundRequestId?: string; refundTransactionNo?: string;
}
export interface OrderReader {
  findLegacy(id: string): Promise<OrderView | null>;
  findCheckout(id: string): Promise<Omit<OrderView, "items"> | null>;
  listItems(id: string): Promise<OrderLineView[]>;
  listByCustomer(email: string): Promise<OrderSummary[]>;
}
