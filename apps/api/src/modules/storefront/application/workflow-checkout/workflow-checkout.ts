import type { CheckoutItem } from "../../domain/checkout.js";
import { CreateCheckout } from "../create-checkout/create-checkout.js";
import { InsufficientOrderStock } from "../ports/order-finalization-ports.js";
import type { OrderFinalizationEffects } from "../ports/order-finalization-ports.js";
import { OrderActionError } from "../order-action.error.js";

export interface CheckoutPaymentReader {
  find(orderId: string): Promise<{ customerEmail: string; paymentUrl: string; txnRef: string;
    amount: number; orderInfo: string; expiresAt: string } | null>;
}

export class WorkflowCheckout {
  constructor(private readonly checkout: CreateCheckout, private readonly effects: OrderFinalizationEffects) {}
  async execute(email: string, items: CheckoutItem[], requestId: string) {
    if (!requestId) throw new OrderActionError("INVALID_INPUT", "Workflow requires a stable requestId.");
    try {
      const result = await this.checkout.execute(email, { items, requestId });
      return { ...result, outcome: "success" as const, requestId, customer: email, itemCount: result.items.length };
    } catch (error) {
      if (!(error instanceof InsufficientOrderStock)) throw error;
      const failureReason = "Insufficient stock for one or more order items.";
      await this.effects.failed(email, items, requestId, failureReason);
      return { outcome: "failed" as const, requestId, orderId: "", customer: email, status: "failed", failureReason };
    }
  }
}

export class ReadWorkflowPayment {
  constructor(private readonly payments: CheckoutPaymentReader) {}
  async execute(email: string, orderId: string) {
    const payment = await this.payments.find(orderId);
    if (!payment || payment.customerEmail !== email) throw new OrderActionError("NOT_FOUND", "Checkout payment not found.");
    const { customerEmail: _email, ...result } = payment;
    return { ...result, timeoutMinutes: 5 };
  }
}
