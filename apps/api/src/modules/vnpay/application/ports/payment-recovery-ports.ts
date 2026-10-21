import type { PaymentSession, VerifiedPaymentCallback } from "../../domain/payment.js";

export const recoveryLanes = ["pending", "success", "failed", "checkout"] as const;
export type RecoveryLane = typeof recoveryLanes[number] | "refund";
export interface RecoveryPage { ids: string[]; checkpoint: string; }
export interface PaymentRecoveryQueue {
  /** Bounded evaluated page, including empty filtered pages. */
  page(lane: RecoveryLane, limit: number): Promise<RecoveryPage>;
  checkpoint(lane: RecoveryLane, checkpoint: string): Promise<void>;
}
export interface RecoverablePayment extends PaymentSession {
  createdAt: string;
  expiresAt: string;
  transactionDate?: string;
  recoveryAttempts?: number;
  recoveryNextAt?: string;
}
export interface PaymentRecoverySessions {
  find(txnRef: string): Promise<RecoverablePayment | null>;
  defer(txnRef: string, attempts: number, nextAt: string): Promise<void>;
}
export interface PaymentStatusGateway {
  /** Query only. null means no authoritative successful payment was established. */
  query(session: RecoverablePayment): Promise<VerifiedPaymentCallback | null>;
}
export interface CheckoutProvisioning { resume(orderId: string): Promise<void>; }
