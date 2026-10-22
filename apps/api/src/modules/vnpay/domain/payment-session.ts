import type { PaymentSession, VerifiedPaymentCallback } from "./payment.js";
export class Payment<T extends PaymentSession = PaymentSession> {
    readonly #state: Readonly<T>;
    constructor(snapshot: T) { this.#state = Object.freeze({ ...snapshot }); }
    toSnapshot(): T { return { ...this.#state }; }
    get isPending() { return this.#state.status === "pending"; }
    get isFinal() { return this.#state.status === "success" || this.#state.status === "failed"; }
    get needsDispatch() { return !this.#state.paymentEventEnqueuedAt; }
    matchesAmount(amountMinor: string) {
        return Number.isSafeInteger(this.#state.amount * 100) && this.#state.amount * 100 === Number(amountMinor);
    }
    matchesOutcome(callback: VerifiedPaymentCallback) {
        return this.#state.status === callback.transactionStatus && this.#state.responseCode === callback.responseCode &&
            this.#state.transactionNo === callback.transactionNo &&
            (!this.#state.gatewayTransactionStatus || this.#state.gatewayTransactionStatus === callback.gatewayTransactionStatus);
    }
    dispatchEvent() {
        const session = this.#state;
        if (!session.email)
            throw new Error("Payment has no customer email; reconciliation required");
        if (!this.isFinal)
            throw new Error("Cannot dispatch a non-final payment");
        const requestId = session.orderId ?? session.orderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
        return { email: session.email, txnRef: session.txnRef, amount: session.amount, orderInfo: session.orderInfo,
            requestId, responseCode: session.responseCode ?? "", transactionNo: session.transactionNo ?? "",
            bankCode: session.bankCode ?? "", payDate: session.payDate ?? "" };
    }
    failureRelease() {
        if (this.#state.status !== "failed")
            return null;
        const event = this.dispatchEvent();
        return event.requestId ? { orderId: event.requestId, email: event.email, amount: event.amount,
            txnRef: event.txnRef, cancelled: event.responseCode === "24" } : null;
    }
}
