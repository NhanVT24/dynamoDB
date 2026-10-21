export interface NotifiedOrders {
  findById(id: string): Promise<{ customerEmail: string; status: string } | null>;
  hasSentSystemNotification(orderId: string, customerEmail: string): Promise<boolean>;
  /** Conditional pending -> done and its status audit must commit atomically. */
  completePending(id: string): Promise<boolean>;
}

/** Legacy fulfillment rule; this does not settle a checkout payment. */
export class CompleteNotifiedOrder {
  constructor(private readonly orders: NotifiedOrders) {}
  async execute(id: string) {
    const order = await this.orders.findById(id);
    if (!order || order.status !== "pending") return { changed: false, completed: order?.status === "done" };
    if (!await this.orders.hasSentSystemNotification(id, order.customerEmail)) return { changed: false, completed: false };
    return { changed: await this.orders.completePending(id), completed: true };
  }
}
