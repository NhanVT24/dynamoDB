import type { RefundGateway } from "../../application/ports/order-lifecycle-ports.js";
import { OrderActionError } from "../../application/order-action.error.js";
import type { VnpayService } from "../../../vnpay/vnpay.service.js";
import { getPaymentSessionByTxnRef } from "../../../vnpay/vnpay.repository.js";
import { queryVnpayRefund, sendVnpayRefund } from "./vnpay-refund-client.js";

export class VnpayRefundGateway implements RefundGateway {
  constructor(private readonly config: () => ReturnType<VnpayService["getPaymentConfig"]>) {}

  async findPayment(reference: string) {
    const session = await getPaymentSessionByTxnRef(reference);
    return session ? { reference: session.txnRef, amount: session.amount, status: session.status, orderId: session.orderId } : null;
  }

  assertReady(): void {
    const config = this.config();
    if (new URL(config.vnpayPaymentUrl).hostname !== "sandbox.vnpayment.vn" &&
      (!config.vnpayTransactionUrl || !config.vnpayMerchantIp)) {
      throw new OrderActionError("CONFLICT", "VNPAY refund endpoint is not configured.");
    }
  }

  private async confirmedSession(reference: string, amount: number, orderId?: string) {
    const session = await getPaymentSessionByTxnRef(reference);
    if (!session || session.status !== "success" || session.amount !== amount ||
      (orderId && session.orderId && session.orderId !== orderId)) {
      throw new Error("Confirmed payment no longer matches the refund");
    }
    return session;
  }

  async request(input: Parameters<RefundGateway["request"]>[0]) {
    const config = this.config();
    const result = await sendVnpayRefund({ session: await this.confirmedSession(input.paymentReference, input.amount, input.orderId),
      requestId: input.requestId, orderId: input.orderId, secret: config.vnpayHashSecret,
      tmnCode: config.vnpayTmnCode, paymentUrl: config.vnpayPaymentUrl,
      transactionUrl: config.vnpayTransactionUrl, merchantIp: config.vnpayMerchantIp });
    const status = result.responseCode === "00" && result.transactionStatus === "06" ? "refund_sent" as const
      : result.transactionStatus === "09" || ["91", "95"].includes(result.responseCode) ? "refund_rejected" as const : "refund_pending" as const;
    return { status, gatewayStatus: result.transactionStatus, transactionNo: result.transactionNo };
  }

  async query(input: Parameters<RefundGateway["query"]>[0]) {
    const config = this.config();
    const result = await queryVnpayRefund({ session: await this.confirmedSession(input.paymentReference, input.amount),
      refundTransactionNo: input.refundTransactionNo, secret: config.vnpayHashSecret,
      tmnCode: config.vnpayTmnCode, paymentUrl: config.vnpayPaymentUrl,
      transactionUrl: config.vnpayTransactionUrl, merchantIp: config.vnpayMerchantIp });
    if (!result || (result.transactionStatus !== "06" && result.transactionStatus !== "09")) return null;
    return { status: result.transactionStatus === "06" ? "refund_sent" as const : "refund_rejected" as const,
      gatewayStatus: result.transactionStatus, transactionNo: result.transactionNo };
  }
}
