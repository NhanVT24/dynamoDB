export interface PaymentReview {
  txnRef: string;
  orderId: string;
  amount: number;
  reason: "PAID_AFTER_RELEASE" | "CORRELATION_MISMATCH" | "PROVIDER_UNCONFIRMED";
}
export interface PaymentReviewWriter { open(review: PaymentReview): Promise<void>; }
/** Catch only after the durable manual-review record has been written. */
export class PaymentReviewRequired extends Error {
  constructor(readonly txnRef: string) { super("Payment reconciliation required; durable manual review recorded"); this.name = "PaymentReviewRequired"; }
}
