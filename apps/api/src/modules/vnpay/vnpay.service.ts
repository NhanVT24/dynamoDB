import crypto from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Injectable, Logger } from "@nestjs/common";
import {
  logQueueBusinessEvent,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { getShoppingItem } from "../shopping/shopping.repository.js";
import {
  getAwaitingPaymentOrder,
  transitionAwaitingPaymentOrder
} from "../storefront/storefront.repository.js";
import {
  createPaymentSession,
  getPaymentSessionByTxnRef,
  markPaymentEventEnqueued,
  updatePaymentSessionStatus,
  type PaymentSessionRecord
} from "./vnpay.repository.js";
import { serializeVnpayParams, signVnpayParams, verifyVnpaySignature } from "./vnpay-signature.js";
import type { CreateVnpayFailureTestInput, CreateVnpayPaymentInput } from "./vnpay.schema.js";

const PAYMENT_TIMEOUT_MINUTES = 5;
const PAYMENT_TIMEOUT_MS = PAYMENT_TIMEOUT_MINUTES * 60 * 1000;
const PAYMENT_TIMEOUT_MESSAGE = "Phiên thanh toán hoặc thời gian giữ hàng đã hết hạn.";
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

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

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatVnpDate(date: Date) {
  const vietnamDate = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return `${vietnamDate.getUTCFullYear()}${pad(vietnamDate.getUTCMonth() + 1)}${pad(vietnamDate.getUTCDate())}${pad(vietnamDate.getUTCHours())}${pad(vietnamDate.getUTCMinutes())}${pad(vietnamDate.getUTCSeconds())}`;
}

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

function extractOrderId(orderInfo: string) {
  return orderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
}

@Injectable()
export class VnpayService {
  private readonly logger = new Logger(VnpayService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly runtimeConfigService: RuntimeConfigService
  ) {}

  async createPaymentUrl(
    input: CreateVnpayPaymentInput,
    ipAddress: string,
    options?: { skipStockValidation?: boolean; expiresAt?: string; amount?: number }
  ) {
    const paymentConfig = this.runtimeConfigService.getPaymentConfig();
    let totalAmount = 0;

    for (const item of input.items) {
      const product = await getShoppingItem(item.productId);
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm ${item.productId}.`);
      }

      if (!options?.skipStockValidation && Number(product.stock ?? 0) < item.quantity) {
        throw new Error(`Sản phẩm ${product.name} hiện không đủ số lượng.`);
      }

      totalAmount += Number(product.price ?? 0) * item.quantity;
    }

    const amount = options?.amount ?? totalAmount;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Payment amount must be a positive integer.");
    }

    const txnRef = `NX${crypto.randomUUID().replace(/-/g, "")}`;
    const createdAt = new Date();
    const configuredExpiry = options?.expiresAt ? new Date(options.expiresAt) : null;
    if (configuredExpiry && (!Number.isFinite(configuredExpiry.getTime()) || configuredExpiry.getTime() <= createdAt.getTime())) {
      throw new Error("Checkout reservation expired before the VNPay session could be created.");
    }
    const expiresAt = configuredExpiry ?? new Date(createdAt.getTime() + PAYMENT_TIMEOUT_MS);
    const createDate = formatVnpDate(createdAt);
    const expireDate = formatVnpDate(expiresAt);
    const orderInfo = input.orderDescription?.trim() || `Payment for ${txnRef}`;
    const resolvedIpAddress = ipAddress || "127.0.0.1";
    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: paymentConfig.vnpayTmnCode,
      vnp_Amount: String(amount * 100),
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
      vnp_CurrCode: "VND",
      vnp_IpAddr: resolvedIpAddress,
      vnp_Locale: input.locale || "vn",
      vnp_OrderInfo: orderInfo,
      vnp_OrderType: "other",
      vnp_ReturnUrl: paymentConfig.vnpayReturnUrl,
      vnp_TxnRef: txnRef
    };

    if (input.bankCode?.trim()) {
      params.vnp_BankCode = input.bankCode.trim();
    }

    const query = serializeVnpayParams(params);
    const secureHash = signVnpayParams(params, paymentConfig.vnpayHashSecret);
    const paymentUrl = `${paymentConfig.vnpayPaymentUrl}?${query}&vnp_SecureHash=${secureHash}`;

    await createPaymentSession({
      txnRef,
      email: input.email?.trim().toLowerCase(),
      orderInfo,
      amount,
      expiresAt: expiresAt.toISOString()
    });

    this.logger.log(`[payment-vnpay] created txnRef=${txnRef} amount=${amount} itemCount=${input.items.length} expiresAt=${expiresAt.toISOString()}`);

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
          expiresAt: expiresAt.toISOString(),
          timeoutMinutes: PAYMENT_TIMEOUT_MINUTES
        }
      }, `payment.created.audit_failed txnRef=${txnRef} email=${normalizedEmail}`);
    }

    return {
      paymentUrl,
      txnRef,
      amount,
      orderInfo,
      expiresAt: expiresAt.toISOString(),
      timeoutMinutes: PAYMENT_TIMEOUT_MINUTES
    };
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
      let session = await getPaymentSessionByTxnRef(result.txnRef);
      if (!session) return { RspCode: "01", Message: "Order not found" };
      if (!Number.isSafeInteger(session.amount * 100) || session.amount * 100 !== Number(result.amountMinor)) {
        return { RspCode: "04", Message: "Invalid amount" };
      }
      let alreadyConfirmed = session.status !== "pending";
      if (!alreadyConfirmed) {
        try {
          // Reservation expiry must never turn a paid transaction into an unpaid one.
          session = await updatePaymentSessionStatus({
            txnRef: result.txnRef, status: result.transactionStatus === "success" ? "success" : "failed",
            responseCode: result.responseCode, transactionStatus: result.gatewayTransactionStatus,
            transactionNo: result.transactionNo, bankCode: result.bankCode, payDate: result.payDate
          });
        } catch (error) {
          if (!isConditionalCheckFailedError(error)) throw error;
          // Another IPN won the update. Read its durable outcome before acknowledging.
          session = await getPaymentSessionByTxnRef(result.txnRef);
          alreadyConfirmed = true;
        }
      }
      if (!session || session.status !== result.transactionStatus
        || session.responseCode !== result.responseCode
        || session.transactionNo !== result.transactionNo
        || (session.gatewayTransactionStatus && session.gatewayTransactionStatus !== result.gatewayTransactionStatus)) {
        throw new Error("Conflicting payment callback; reconciliation required");
      }
      // Resume interrupted dispatch on duplicate callbacks before terminal ACK 02.
      await this.dispatchPaymentEvent(session);
      return alreadyConfirmed ? { RspCode: "02", Message: "Order already confirmed" }
        : { RspCode: "00", Message: "Confirm Success" };
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "vnpay.ipn_processing_failed", requestId,
        error: error instanceof Error ? error.message : "unknown" }));
      return { RspCode: "99", Message: "Internal error" };
    }
  }

  private async dispatchPaymentEvent(session: PaymentSessionRecord) {
    if (session.paymentEventEnqueuedAt) return;
    const requestId = extractOrderId(session.orderInfo);
    const input = {
      email: session.email, txnRef: session.txnRef, amount: session.amount,
      orderInfo: session.orderInfo, requestId,
      responseCode: session.responseCode ?? "", transactionNo: session.transactionNo ?? "",
      bankCode: session.bankCode ?? "", payDate: session.payDate ?? ""
    };
    if (session.status === "failed" && requestId) {
      const order = await getAwaitingPaymentOrder(requestId);
      if (order) {
        await transitionAwaitingPaymentOrder({
          orderId: requestId,
          status: session.responseCode === "24" ? "cancelled" : "payment_failed"
        });
      }
    }
    if (!session.email) {
      // Recording money must not depend on an optional notification address.
      this.logger.warn(JSON.stringify({ event: "vnpay.notification_skipped", txnRef: session.txnRef, reason: "missing_email" }));
      if (requestId) throw new Error("Checkout payment has no customer email; reconciliation required");
      return;
    }
    if (session.status === "success") {
      await this.publishAndMarkPaymentCompletedEvent({ ...input, email: session.email }, "ipn");
    } else {
      await this.enqueueFailedPaymentNotification({ ...input, email: session.email,
        failureReason: session.responseCode === "00" ? "VNPay has not confirmed payment success."
          : mapResponseCode(session.responseCode ?? "") }, "ipn");
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
      amount: input.amount
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
    source: "return" | "ipn"
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

  private async publishAndMarkPaymentCompletedEvent(
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
  },
    source: "return" | "ipn"
  ) {
    const published = await this.notificationsService.publishPaymentCompletedEvent(input);
    if (!published.queued) throw new Error("Payment event publishing is disabled");
    await this.markPaymentEventEnqueuedSafely(input.txnRef, source);
    logQueueBusinessEvent(this.logger, {
      queue: "paymentEvents",
      eventType: "payment.completed",
      status: "enqueued",
      txnRef: input.txnRef,
      details: { source }
    });
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

  private async markPaymentEventEnqueuedSafely(txnRef: string, source: "return" | "ipn") {
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
