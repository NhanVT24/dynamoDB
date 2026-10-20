import { samePaymentOutcome } from "../domain/payment.js";
import type { PaymentSession, VerifiedPaymentCallback } from "../domain/payment.js";
import type { PaymentSessions, PaymentEvents, FailedPaymentOrders, PaymentLog } from "./ports/payment-ports.js";

export class PaymentProcessing {
  constructor(private readonly sessions: PaymentSessions, private readonly events: PaymentEvents,
    private readonly orders: FailedPaymentOrders, private readonly log: PaymentLog) {}

  async confirm(callback: VerifiedPaymentCallback) {
    let session = await this.sessions.find(callback.txnRef);
    if (!session) return { outcome: "not_found" as const };
    if (!Number.isSafeInteger(session.amount * 100) || session.amount * 100 !== Number(callback.amountMinor)) {
      return { outcome: "invalid_amount" as const };
    }
    let alreadyConfirmed = session.status !== "pending";
    if (!alreadyConfirmed) {
      const outcome = await this.sessions.confirm(callback);
      session = outcome.session;
      alreadyConfirmed = !outcome.changed;
    }
    if (!session || !samePaymentOutcome(session, callback)) {
      throw new Error("Conflicting payment callback; reconciliation required");
    }
    // A duplicate must resume an interrupted hand-off before acknowledging.
    await this.dispatch(session);
    return { outcome: alreadyConfirmed ? "already_confirmed" as const : "confirmed" as const };
  }

  async reconcile(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid payment reconciliation limit");
    const candidates = await this.sessions.listUndispatched(limit);
    let enqueued = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        // Never trust a stale GSI projection for the financial outcome.
        const session = await this.sessions.find(candidate.txnRef);
        if (!session || session.status === "pending" || session.status === "expired") continue;
        await this.dispatch(session);
        enqueued++;
      } catch (error) { failed++; this.log.error("payment.reconciliation_failed", { txnRef: candidate.txnRef, error: String(error) }); }
    }
    return { checked: candidates.length, enqueued, failed };
  }

  private async dispatch(session: PaymentSession) {
    if (session.paymentEventEnqueuedAt) return;
    const requestId = session.orderId ?? session.orderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    if (!session.email) throw new Error("Payment has no customer email; reconciliation required");
    if (session.status === "failed" && requestId) {
      await this.orders.release({ orderId: requestId, email: session.email, amount: session.amount,
        txnRef: session.txnRef, cancelled: session.responseCode === "24" });
    }
    const event = { email: session.email, txnRef: session.txnRef, amount: session.amount,
      orderInfo: session.orderInfo, requestId, responseCode: session.responseCode ?? "",
      transactionNo: session.transactionNo ?? "", bankCode: session.bankCode ?? "", payDate: session.payDate ?? "" };
    if (session.status === "success") await this.events.publishCompleted(event);
    else if (session.status === "failed") await this.events.publishFailed(event);
    else throw new Error("Cannot dispatch a non-final payment");
    // Publish first, mark second: replay is possible; downstream MUST be idempotent.
    await this.sessions.markDispatched(session.txnRef);
  }
}
