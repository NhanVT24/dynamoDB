import type { SettledPayments } from "../../storefront/application/ports/checkout-ports.js";
import { getPaymentSessionByTxnRef } from "../vnpay.repository.js";

function parsePaymentDate(value?: string): string | undefined {
  if (!value || !/^\d{14}$/.test(value)) return undefined;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10)), minute = Number(value.slice(10, 12)), second = Number(value.slice(12, 14));
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
    local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) return undefined;
  const timestamp = local.getTime() - 7 * 60 * 60 * 1000;
  return timestamp <= Date.now() + 60000 ? new Date(timestamp).toISOString() : undefined;
}

export class DurableSettledPayments implements SettledPayments {
  async find(txnRef: string) {
    const payment = await getPaymentSessionByTxnRef(txnRef);
    return payment ? { status: payment.status, amount: payment.amount, email: payment.email, orderId: payment.orderId,
      // The refund window must come from the durable signed IPN, not an event's
      // editable payDate or the later worker execution time.
      paymentConfirmedAt: parsePaymentDate(payment.payDate) ?? payment.paidAt } : null;
  }
}
