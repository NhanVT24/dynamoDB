import { getPaymentSessionByTxnRef,
  markPaymentEventEnqueued, updatePaymentSessionStatus } from "../vnpay.repository.js";
import type { PaymentSessions } from "../application/ports/payment-ports.js";
import type { VerifiedPaymentCallback } from "../domain/payment.js";

const conditional = (error: unknown) => (error as { name?: string })?.name === "ConditionalCheckFailedException";
export class DynamoPaymentSessions implements PaymentSessions {
  find = getPaymentSessionByTxnRef;
  async confirm(callback: VerifiedPaymentCallback) {
    try {
      const session = await updatePaymentSessionStatus({ ...callback, status: callback.transactionStatus,
        transactionStatus: callback.gatewayTransactionStatus });
      return { session, changed: true };
    } catch (error) {
      if (!conditional(error)) throw error;
      return { session: await this.find(callback.txnRef), changed: false };
    }
  }
  async markDispatched(txnRef: string) {
    try { await markPaymentEventEnqueued(txnRef); }
    catch (error) { if (!conditional(error)) throw error; }
  }
}
