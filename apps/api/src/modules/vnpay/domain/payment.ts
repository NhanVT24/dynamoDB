export type PaymentStatus = "pending" | "success" | "failed" | "expired";
export interface PaymentSession {
  txnRef: string;
  orderId?: string;
  email?: string;
  orderInfo: string;
  amount: number;
  status: PaymentStatus;
  responseCode?: string;
  gatewayTransactionStatus?: string;
  transactionNo?: string;
  bankCode?: string;
  payDate?: string;
  paymentEventEnqueuedAt?: string;
}
export interface VerifiedPaymentCallback {
  txnRef: string;
  amountMinor: string;
  transactionStatus: "success" | "failed";
  gatewayTransactionStatus: string;
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
}
export function samePaymentOutcome(session: PaymentSession, callback: VerifiedPaymentCallback) {
  return session.status === callback.transactionStatus && session.responseCode === callback.responseCode &&
    session.transactionNo === callback.transactionNo &&
    (!session.gatewayTransactionStatus || session.gatewayTransactionStatus === callback.gatewayTransactionStatus);
}
