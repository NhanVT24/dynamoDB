import { CreatePayment } from "./application/create-payment.js";
import { PaymentProcessing } from "./application/payment-processing.js";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  logQueueBusinessEvent,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import {
  getPaymentSessionByTxnRef,
  markPaymentEventEnqueued,
} from "./vnpay.repository.js";
import { verifyVnpaySignature } from "./vnpay-signature.js";
import type { CreateVnpayFailureTestInput, CreateVnpayPaymentInput } from "./vnpay.schema.js";

const PAYMENT_TIMEOUT_MINUTES = 5;
const PAYMENT_TIMEOUT_MESSAGE = "Phiên thanh toán hoặc thời gian giữ hàng đã hết hạn.";

type VnpayReturnPayload = {
  isValidSignature: boolean;
  transactionStatus: "pending" | "success" | "failed" | "expired";
  gatewayTransactionStatus: string;
  merchantCode: string;
  amountMinor: string;
  message: string;
  txnRef: string;
  amount: number;
  orderInfo: string;
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
};

function mapResponseCode(code: string) {
  if (code === "00") return "Thanh toán thành công.";
  if (code === "24") return "Khách hàng đã hủy giao dịch.";
  if (code === "51") return "Tài khoản không đủ số dư để thanh toán.";
  if (code === "65") return "Tài khoản đã vượt quá hạn mức giao dịch trong ngày.";
  if (code === "75") return "Ngân hàng thanh toán đang bảo trì hoặc không phản hồi.";
  return "Giao dịch chưa hoàn tất hoặc đã xảy ra lỗi trong quá trình thanh toán.";
}

function isConditionalCheckFailedError(error: unknown) {
  if (error instanceof ConditionalCheckFailedException) {
    return true;
  }

  const candidate = error as { name?: string; code?: string } | null;
  return candidate?.name === "ConditionalCheckFailedException" || candidate?.code === "ConditionalCheckFailedException";
}

@Injectable()
export class VnpayService {
  private readonly logger = new Logger(VnpayService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly runtimeConfigService: RuntimeConfigService,
    @Inject(PaymentProcessing) private readonly processing: PaymentProcessing,
    @Inject(CreatePayment) private readonly createPayment: CreatePayment
  ) {}

  getPaymentConfig() {
    return this.runtimeConfigService.getPaymentConfig();
  }

  async createPaymentUrl(
    input: CreateVnpayPaymentInput,
    ipAddress: string,
    options?: { skipStockValidation?: boolean; expiresAt?: string; amount?: number; orderId?: string }
  ) {
    const payment = await this.createPayment.execute({ ...input, items: input.items.map(item => ({ productId: item.productId ?? "", quantity: item.quantity })) }, ipAddress, options);
    const { txnRef, amount } = payment;
    if (input.email?.trim()) {
      const normalizedEmail = input.email.trim().toLowerCase();

      await this.publishAuditLogSafely({
        eventType: "payments.vnpay.created",
        email: normalizedEmail,
        resourceId: txnRef,
        metadata: {
          amount,
          itemCount: input.items.length,
          bankCode: input.bankCode ?? "",
          status: "pending",
          expiresAt: payment.expiresAt,
          timeoutMinutes: PAYMENT_TIMEOUT_MINUTES
        }
      }, `payment.created.audit_failed txnRef=${txnRef} email=${normalizedEmail}`);
    }

    return payment;
  }

  private parseAndVerifyCallback(rawQuery: Record<string, unknown>, source: "return" | "ipn"): VnpayReturnPayload {
    const config = this.runtimeConfigService.getPaymentConfig();
    const verified = verifyVnpaySignature(rawQuery, config.vnpayHashSecret);
    const { query, isValidSignature } = verified;
    const responseCode = query.vnp_ResponseCode || "";
    const gatewayTransactionStatus = query.vnp_TransactionStatus || "";
    const success = responseCode === "00" && gatewayTransactionStatus === "00";
    this.logger.log(JSON.stringify({
      event: "vnpay.callback_checked", source, reason: verified.reason,
      valid: isValidSignature, hashLength: verified.hashLength,
      queryKeys: Object.keys(rawQuery).sort(),
      txnRef: query.vnp_TxnRef ?? "", responseCode, gatewayTransactionStatus,
      merchantMatches: query.vnp_TmnCode === config.vnpayTmnCode
    }));
    return {
      isValidSignature,
      transactionStatus: isValidSignature && success ? "success" : "failed",
      message: !isValidSignature ? "Vnpay signature is invalid."
        : responseCode === "00" && !success ? "VNPay has not confirmed payment success."
        : mapResponseCode(responseCode),
      txnRef: query.vnp_TxnRef || "",
      amount: Number(query.vnp_Amount || 0) / 100,
      amountMinor: query.vnp_Amount || "",
      merchantCode: query.vnp_TmnCode || "",
      gatewayTransactionStatus,
      orderInfo: query.vnp_OrderInfo || "", responseCode,
      transactionNo: query.vnp_TransactionNo || "",
      bankCode: query.vnp_BankCode || "", payDate: query.vnp_PayDate || ""
    };
  }

  private isValidCallback(result: VnpayReturnPayload) {
    return result.merchantCode === this.runtimeConfigService.getPaymentConfig().vnpayTmnCode
      && /^[a-zA-Z0-9_-]{1,100}$/.test(result.txnRef)
      && /^\d{1,12}$/.test(result.amountMinor)
      && Number.isSafeInteger(Number(result.amountMinor))
      && /^\d{2}$/.test(result.responseCode)
      && /^\d{2}$/.test(result.gatewayTransactionStatus)
      && /^\d{1,15}$/.test(result.transactionNo);
  }

  // A valid signed return query grants read access only to its own transaction.
  // Polling never finalizes payments, releases stock or publishes events.
  async verifyReturn(rawQuery: Record<string, unknown>): Promise<VnpayReturnPayload> {
    const result = this.parseAndVerifyCallback(rawQuery, "return");
    if (!result.isValidSignature) return result;
    if (!this.isValidCallback(result)) {
      return { ...result, transactionStatus: "failed", message: "Invalid VNPay callback data." };
    }
    const session = await getPaymentSessionByTxnRef(result.txnRef);
    if (!session || session.amount * 100 !== Number(result.amountMinor)) {
      return { ...result, transactionStatus: "failed", message: "Payment session or amount does not match." };
    }

    // Return is browser-to-server. It may be abandoned or replayed, so only
    // the server-to-server IPN (or a reconciliation worker) may change money
    // state and publish the payment event.
    return {
      ...result, transactionStatus: session.status,
      amount: session.amount, orderInfo: session.orderInfo,
      responseCode: session.responseCode ?? result.responseCode,
      gatewayTransactionStatus: session.gatewayTransactionStatus ?? result.gatewayTransactionStatus,
      transactionNo: session.transactionNo ?? result.transactionNo,
      bankCode: session.bankCode ?? result.bankCode,
      payDate: session.payDate ?? result.payDate,
      message: session.status === "pending" ? "Waiting for VNPay payment confirmation."
        : session.status === "success" ? "Payment confirmed by VNPay IPN."
        : session.status === "expired" ? PAYMENT_TIMEOUT_MESSAGE : "Payment was not successful."
    };
  }

  async verifyIpn(rawQuery: Record<string, unknown>, requestId?: string) {
    try {
      const result = this.parseAndVerifyCallback(rawQuery, "ipn");
      this.logger.log(JSON.stringify({ event: "vnpay.ipn_received", requestId, txnRef: result.txnRef }));
      if (!result.isValidSignature) return { RspCode: "97", Message: "Invalid Checksum" };
      if (!this.isValidCallback(result)) return { RspCode: "99", Message: "Invalid callback data" };
      const confirmed = await this.processing.confirm({ ...result,
        transactionStatus: result.transactionStatus === "success" ? "success" : "failed" });
      // Provider response codes belong to the VNPay adapter, not the use case.
      const responses = {
        not_found: { RspCode: "01", Message: "Order not found" },
        invalid_amount: { RspCode: "04", Message: "Invalid amount" },
        already_confirmed: { RspCode: "02", Message: "Order already confirmed" },
        confirmed: { RspCode: "00", Message: "Confirm Success" }
      };
      return responses[confirmed.outcome];
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "vnpay.ipn_processing_failed", requestId,
        error: error instanceof Error ? error.message : "unknown" }));
      return { RspCode: "99", Message: "Internal error" };
    }
  }


  async createFailureTestNotification(email: string, input: CreateVnpayFailureTestInput) {
    const txnRef = `TEST${input.mode.toUpperCase()}${Date.now()}`;
    const failureReason = input.mode === "cancel"
      ? "Khách hàng đã hủy giao dịch trên VNPay."
      : PAYMENT_TIMEOUT_MESSAGE;
    const responseCode = input.mode === "cancel" ? "24" : "TIMEOUT";
    const payDate = input.mode === "cancel" ? new Date().toISOString() : "";

    await this.enqueueFailedPaymentNotification({
      email: email.trim().toLowerCase(),
      txnRef,
      amount: input.amount,
      orderInfo: input.orderInfo?.trim() || `Thanh toán test ${input.mode} từ console browser`,
      responseCode,
      transactionNo: input.mode === "cancel" ? "0" : "",
      bankCode: input.bankCode,
      payDate,
      failureReason
    }, "return");

    return {
      success: true,
      txnRef,
      mode: input.mode,
      email: email.trim().toLowerCase(),
      message: `Đã tạo test thanh toán ${input.mode === "cancel" ? "hủy" : "hết hạn"} cho ${email.trim().toLowerCase()}.`
    };
  }

  async createWorkflowPaymentUrl(input: {
    email: string;
    items: CreateVnpayPaymentInput["items"];
    orderId?: string;
    orderDescription?: string;
    bankCode?: string;
    locale?: "vn" | "en";
    ipAddress?: string;
    skipStockValidation?: boolean;
    expiresAt?: string;
    amount?: number;
  }) {
    return this.createPaymentUrl({
      email: input.email,
      items: input.items,
      orderDescription: input.orderDescription?.trim() || (input.orderId ? `Thanh toán đơn hàng ${input.orderId}` : "Thanh toán đơn hàng"),
      bankCode: input.bankCode,
      locale: input.locale
    }, input.ipAddress?.trim() || "127.0.0.1", {
      skipStockValidation: input.skipStockValidation,
      expiresAt: input.expiresAt,
      amount: input.amount,
      orderId: input.orderId
    });
  }

  private async enqueueFailedPaymentNotification(
    input: {
      email: string;
      txnRef: string;
      amount: number;
      orderInfo: string;
      requestId?: string;
      responseCode: string;
      transactionNo: string;
      bankCode: string;
      payDate: string;
      failureReason: string;
    },
    source: "return" | "ipn" | "reconciliation"
  ) {
    try {
      this.logger.log(
        `[queue-payment] failed_enqueue_begin txnRef=${input.txnRef} source=${source} to=${input.email} responseCode=${input.responseCode}`
      );
      const published = await this.notificationsService.publishPaymentFailedEvent(input);
      if (!published.queued) throw new Error("Payment event publishing is disabled");
      await this.markPaymentEventEnqueuedSafely(input.txnRef, source);
      logQueueBusinessEvent(this.logger, {
        queue: "paymentEvents",
        eventType: "payment.failed",
        status: "enqueued",
        txnRef: input.txnRef,
        details: { source }
      });
    } catch (error) {
      logQueueWarn(this.logger, {
        queue: "paymentEvents",
        eventType: "payment.failed",
        status: "enqueue_failed",
        txnRef: input.txnRef,
        message: error instanceof Error ? error.message : "unknown"
      });
      throw error;
    }
  }

  private async publishAuditLogSafely(
    input: Parameters<NotificationsService["publishAuditLog"]>[0],
    failureLogMessage: string
  ) {
    try {
      await this.notificationsService.publishAuditLog(input);
      this.logger.log(`[queue-audit] payment_enqueued resourceId=${input.resourceId ?? ""} eventType=${input.eventType}`);
    } catch (error) {
      this.logger.warn(`${failureLogMessage} error=${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async markPaymentEventEnqueuedSafely(txnRef: string, source: "return" | "ipn" | "reconciliation") {
    try {
      await markPaymentEventEnqueued(txnRef);
    } catch (error) {
      if (isConditionalCheckFailedError(error)) {
        this.logger.log(`[queue-payment] already_enqueued txnRef=${txnRef} source=${source}`);
        return;
      }

      throw error;
    }
  }
}
