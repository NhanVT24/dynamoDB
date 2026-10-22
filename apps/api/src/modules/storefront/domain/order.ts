import { OrderActionError } from "./order.error.js";
export const REFUND_WINDOW_MS = 5 * 60 * 1000;
export interface OrderSnapshot {
    id: string;
    customerEmail: string;
    status: string;
    totalAmount?: number;
    paymentTxnRef?: string;
    paymentConfirmedAt?: string;
    refundRequestId?: string;
    refundStatus?: string;
    refundTransactionNo?: string;
}
export class Order<T extends OrderSnapshot = OrderSnapshot> {
    readonly #state: Readonly<T>;
    constructor(snapshot: T) { this.#state = Object.freeze({ ...snapshot }); }
    toSnapshot(): T { return { ...this.#state }; }
    isOwnedBy(email: string) { return this.#state.customerEmail === email; }
    assertOwnedBy(email: string): void {
        if (!this.isOwnedBy(email))
            throw new OrderActionError("NOT_FOUND", "Order not found.");
    }
    assertAwaitingPayment(): void {
        if (this.#state.status !== "awaiting_payment") {
            throw new OrderActionError("CONFLICT", "Checkout already has a payment session or has ended.");
        }
    }
    get isReleased() { return ["expired", "cancelled", "payment_failed"].includes(this.#state.status); }
    get isAwaitingLegacyCompletion() { return this.#state.status === "pending"; }
    get isLegacyCompleted() { return this.#state.status === "done"; }
    static isTerminalRefundStatus(status: string) { return status === "refund_sent" || status === "refund_rejected"; }
    get isTerminalRefund() { return Order.isTerminalRefundStatus(this.#state.status); }
    matchesPayment(input: {
        email: string;
        amount: number;
        txnRef: string;
    }) {
        return this.isOwnedBy(input.email) && this.#state.totalAmount === input.amount && this.#state.paymentTxnRef === input.txnRef;
    }
    isRefundEligibleAt(now: number) {
        const paidAt = this.#state.paymentConfirmedAt ? Date.parse(this.#state.paymentConfirmedAt) : NaN;
        return this.#state.status === "paid" && Boolean(this.#state.paymentTxnRef) && Number.isFinite(paidAt) && now < paidAt + REFUND_WINDOW_MS;
    }
    matchesRefundPayment(payment: {
        status: string;
        amount: number;
        orderId?: string;
    } | null) {
        return Boolean(payment && payment.status === "success" && payment.amount === this.#state.totalAmount &&
            (!payment.orderId || payment.orderId === this.#state.id));
    }
    claimRefund(requestId: string, now: number): Order<T & {
        status: "refund_pending";
        refundStatus: string;
        refundRequestId: string;
    }> {
        if (!requestId.trim())
            throw new OrderActionError("INVALID_INPUT", "Refund request identity is required.");
        if (this.#state.refundRequestId || !this.isRefundEligibleAt(now)) {
            throw new OrderActionError("CONFLICT", "Refund is available for 5 minutes after confirmed payment.");
        }
        return new Order({ ...this.#state, status: "refund_pending", refundStatus: "pending", refundRequestId: requestId });
    }
    refundResponse() {
        return { orderId: this.#state.id, status: this.#state.status, refundStatus: this.#state.refundStatus };
    }
    canCompleteLegacyNotification(sentSystemNotification: boolean) {
        return this.#state.status === "pending" && sentSystemNotification;
    }
}
