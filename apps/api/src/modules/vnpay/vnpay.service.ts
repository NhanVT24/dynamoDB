import crypto from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Injectable, Logger } from "@nestjs/common";
import {
  logQueueBusinessEvent,
  logQueueWarn
} from "../../common/logging/queue-logger.js";
import { env } from "../../config/env.js";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import {
  getCheckoutGateRequestById,
  getStorefrontProductById,
  releaseCheckoutGateReservation
} from "../storefront/storefront.repository.js";
import {
  createPaymentSession,
  getPaymentSessionByTxnRef,
  markPaymentEventEnqueued,
  updatePaymentSessionStatus,
  type PaymentSessionRecord
} from "./vnpay.repository.js";
import type { CreateVnpayFailureTestInput, CreateVnpayPaymentInput } from "./vnpay.schema.js";

const PAYMENT_TIMEOUT_MINUTES = 5;
const PAYMENT_TIMEOUT_MS = PAYMENT_TIMEOUT_MINUTES * 60 * 1000;
const PAYMENT_TIMEOUT_MESSAGE = "Phiên thanh toán hoặc thời gian giữ hàng đã hết hạn.";
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

type VnpayReturnPayload = {
  isValidSignature: boolean;
  transactionStatus: "success" | "failed" | "expired";
  message: string;
  txnRef: string;
  amount: number;
  orderInfo: string;
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
};

type VnpayHandlingOverride = Pick<VnpayReturnPayload, "transactionStatus" | "message">;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatVnpDate(date: Date) {
  const vietnamDate = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return `${vietnamDate.getUTCFullYear()}${pad(vietnamDate.getUTCMonth() + 1)}${pad(vietnamDate.getUTCDate())}${pad(vietnamDate.getUTCHours())}${pad(vietnamDate.getUTCMinutes())}${pad(vietnamDate.getUTCSeconds())}`;
}

function sortAndSerialize(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key]).replace(/%20/g, "+")}`)
    .join("&");
}

function signPayload(payload: string, secret: string) {
  return crypto.createHmac("sha512", secret).update(Buffer.from(payload, "utf-8")).digest("hex");
}

function mapResponseCode(code: string) {
  if (code === "00") return "Thanh toán thành công.";
  if (code === "24") return "Khách hàng đã hủy giao dịch.";
  if (code === "51") return "Tài khoản không đủ số dư để thanh toán.";
  if (code === "65") return "Tài khoản đã vượt quá hạn mức giao dịch trong ngày.";
  if (code === "75") return "Ngân hàng thanh toán đang bảo trì hoặc không phản hồi.";
  return "Giao dịch chưa hoàn tất hoặc đã xảy ra lỗi trong quá trình thanh toán.";
}

function isPaymentSessionExpired(session: Pick<PaymentSessionRecord, "expiresAt">) {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function isConditionalCheckFailedError(error: unknown) {
  if (error instanceof ConditionalCheckFailedException) {
    return true;
  }

  const candidate = error as { name?: string; code?: string } | null;
  return candidate?.name === "ConditionalCheckFailedException" || candidate?.code === "ConditionalCheckFailedException";
}

function extractCheckoutGateRequestId(orderInfo: string) {
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
    options?: { skipStockValidation?: boolean; expiresAt?: string }
  ) {
    const paymentConfig = this.runtimeConfigService.getPaymentConfig();
    let totalAmount = 0;

    for (const item of input.items) {
      const product = await getStorefrontProductById(item.productId);
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm ${item.productId}.`);
      }

      if (!options?.skipStockValidation && Number(product.stock ?? 0) < item.quantity) {
        throw new Error(`Sản phẩm ${product.name} hiện không đủ số lượng.`);
      }

      totalAmount += Number(product.price ?? 0) * item.quantity;
    }

    const txnRef = `NX${Date.now()}`;
    const createdAt = new Date();
    const configuredExpiry = options?.expiresAt ? new Date(options.expiresAt) : null;
    if (configuredExpiry && (!Number.isFinite(configuredExpiry.getTime()) || configuredExpiry.getTime() <= createdAt.getTime())) {
      throw new Error("Checkout reservation expired before the VNPay session could be created.");
    }
    const expiresAt = configuredExpiry ?? new Date(createdAt.getTime() + PAYMENT_TIMEOUT_MS);
    const createDate = formatVnpDate(createdAt);
    const expireDate = formatVnpDate(expiresAt);
    const orderInfo = input.orderDescription?.trim() || `Thanh toán đơn hàng ${txnRef}`;
    const resolvedIpAddress = ipAddress || "127.0.0.1";
    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: paymentConfig.vnpayTmnCode,
      vnp_Amount: String(totalAmount * 100),
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

    const query = sortAndSerialize(params);
    const secureHash = signPayload(query, paymentConfig.vnpayHashSecret);
    const paymentUrl = `${paymentConfig.vnpayPaymentUrl}?${query}&vnp_SecureHash=${secureHash}`;

    await createPaymentSession({
      txnRef,
      email: input.email?.trim().toLowerCase(),
      orderInfo,
      amount: totalAmount,
      expiresAt: expiresAt.toISOString()
    });

    this.logger.log(`[payment-vnpay] created txnRef=${txnRef} amount=${totalAmount} itemCount=${input.items.length} expiresAt=${expiresAt.toISOString()}`);

    if (input.email?.trim()) {
      const normalizedEmail = input.email.trim().toLowerCase();

      await this.publishAuditLogSafely({
        eventType: "payments.vnpay.created",
        email: normalizedEmail,
        resourceId: txnRef,
        metadata: {
          amount: totalAmount,
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
      amount: totalAmount,
      orderInfo,
      expiresAt: expiresAt.toISOString(),
      timeoutMinutes: PAYMENT_TIMEOUT_MINUTES
    };
  }

  async verifyReturn(rawQuery: Record<string, unknown>): Promise<VnpayReturnPayload> {
    const paymentConfig = this.runtimeConfigService.getPaymentConfig();
    const query = Object.fromEntries(
      Object.entries(rawQuery).map(([key, value]) => [key, String(value ?? "")])
    ) as Record<string, string>;

    const receivedHash = query.vnp_SecureHash || "";
    const sanitized = { ...query };
    delete sanitized.vnp_SecureHash;
    delete sanitized.vnp_SecureHashType;

    const computedHash = signPayload(sortAndSerialize(sanitized), paymentConfig.vnpayHashSecret);
    const responseCode = query.vnp_ResponseCode || "";
    const isValidSignature = receivedHash === computedHash;
    const success = isValidSignature && responseCode === "00";

    const result: VnpayReturnPayload = {
      isValidSignature,
      transactionStatus: success ? "success" : "failed",
      message: isValidSignature ? mapResponseCode(responseCode) : "Chữ ký phản hồi từ VNPay không hợp lệ.",
      txnRef: query.vnp_TxnRef || "",
      amount: Number(query.vnp_Amount || 0) / 100,
      orderInfo: query.vnp_OrderInfo || "",
      responseCode,
      transactionNo: query.vnp_TransactionNo || "",
      bankCode: query.vnp_BankCode || "",
      payDate: query.vnp_PayDate || ""
    };

    this.logger.log(`[payment-vnpay] return_checked txnRef=${query.vnp_TxnRef || ""} valid=${isValidSignature} responseCode=${responseCode}`);

    try {
      const handled = await this.handlePaymentEvent(result, "return");
      return handled ? { ...result, ...handled } : result;
    } catch (error) {
      this.logger.error(
        `[payment-vnpay] return_processing_failed txnRef=${result.txnRef} responseCode=${result.responseCode} error=${error instanceof Error ? error.message : "unknown"}`,
        error instanceof Error ? error.stack : undefined
      );

      if (result.isValidSignature) {
        const fallbackMessage = result.responseCode === "24"
          ? "Khách hàng đã hủy giao dịch trên VNPay."
          : result.transactionStatus === "success"
            ? "Hệ thống đã ghi nhận giao dịch thành công nhưng có lỗi khi đồng bộ nội bộ."
            : mapResponseCode(result.responseCode);

        return {
          ...result,
          transactionStatus: result.transactionStatus === "success" ? "success" : "failed",
          message: fallbackMessage
        };
      }

      throw error;
    }
  }

  async verifyIpn(rawQuery: Record<string, unknown>) {
    const result = await this.verifyReturn(rawQuery);
    this.logger.log(`[payment-vnpay] ipn_checked txnRef=${result.txnRef} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    if (!result.isValidSignature) {
      return { RspCode: "97", Message: "Invalid Checksum" };
    }

    if (result.transactionStatus === "expired") {
      return { RspCode: "00", Message: "Order Expired" };
    }

    return { RspCode: "00", Message: "Confirm Success" };
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
  }) {
    return this.createPaymentUrl({
      email: input.email,
      items: input.items,
      orderDescription: input.orderDescription?.trim() || (input.orderId ? `Thanh toán đơn hàng ${input.orderId}` : "Thanh toán đơn hàng"),
      bankCode: input.bankCode,
      locale: input.locale
    }, input.ipAddress?.trim() || "127.0.0.1", {
      skipStockValidation: input.skipStockValidation,
      expiresAt: input.expiresAt
    });
  }

  private async handlePaymentEvent(result: VnpayReturnPayload, source: "return" | "ipn"): Promise<VnpayHandlingOverride | null> {
    this.logger.log(`[queue-payment] evaluate txnRef=${result.txnRef} source=${source} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    if (!result.isValidSignature) {
      this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=invalid_signature source=${source}`);
      return null;
    }

    const session = result.txnRef ? await getPaymentSessionByTxnRef(result.txnRef) : null;
    if (!session) {
      this.logger.warn(`[dynamo-payment] session_missing txnRef=${result.txnRef} source=${source}`);
      return {
        transactionStatus: "failed" as const,
        message: "Không tìm thấy phiên thanh toán."
      };
    }

    if (session.status !== "pending") {
      this.logger.log(`[dynamo-payment] session_finalized txnRef=${result.txnRef} source=${source} status=${session.status} email=${session.email ?? ""}`);
      this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=already_finalized_${session.status} source=${source}`);
      return {
        transactionStatus: session.status === "expired" ? "expired" : session.status,
        message: session.status === "expired" ? PAYMENT_TIMEOUT_MESSAGE : mapResponseCode(session.responseCode ?? result.responseCode)
      };
    }

    if (isPaymentSessionExpired(session)) {
      await this.finalizeExpiredPayment(session, result, source);
      return {
        transactionStatus: "expired" as const,
        message: PAYMENT_TIMEOUT_MESSAGE
      };
    }

    if (result.transactionStatus !== "success") {
      const failureReason = result.responseCode === "24"
        ? "Khách hàng đã hủy giao dịch trên VNPay."
        : mapResponseCode(result.responseCode);

      await this.finalizeFailedPayment(session, result, source, failureReason);
      return {
        transactionStatus: "failed" as const,
        message: failureReason
      };
    }

    if (!session.email) {
      this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=missing_payment_session_email source=${source}`);
      return null;
    }

    const resolvedOrderInfo = session.orderInfo || result.orderInfo;
    const requestId = extractCheckoutGateRequestId(resolvedOrderInfo);

    if (requestId) {
      const gate = await getCheckoutGateRequestById(requestId);
      const lockedUntilMs = new Date(String(gate?.lockedUntil ?? "")).getTime();
      if (!gate || gate.status !== "allowed" || !Number.isFinite(lockedUntilMs) || lockedUntilMs <= Date.now()) {
        await this.finalizeExpiredPayment(session, result, source);
        return {
          transactionStatus: "expired" as const,
          message: PAYMENT_TIMEOUT_MESSAGE
        };
      }
    }

    try {
      await updatePaymentSessionStatus({
        txnRef: result.txnRef,
        status: "success",
        responseCode: result.responseCode,
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
        payDate: result.payDate
      });
    } catch (error) {
      if (isConditionalCheckFailedError(error)) {
        this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=finalized_during_success source=${source}`);
        return {
          transactionStatus: "failed" as const,
          message: "Phiên thanh toán đã được chốt bởi một callback khác."
        };
      }

      throw error;
    }

      await this.publishPaymentCompletedEventSafely({
        email: session.email,
        txnRef: result.txnRef,
        amount: result.amount || session.amount,
        orderInfo: resolvedOrderInfo,
        requestId,
        responseCode: result.responseCode,
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
      payDate: result.payDate
    }, source);

    await this.markPaymentEventEnqueuedSafely(result.txnRef, source);
    logQueueBusinessEvent(this.logger, {
      queue: "paymentEvents",
      eventType: "payment.completed",
      status: "enqueued",
      txnRef: result.txnRef,
      details: { source }
    });
    return null;
  }

  private async finalizeExpiredPayment(session: PaymentSessionRecord, result: VnpayReturnPayload, source: "return" | "ipn") {
    try {
      await updatePaymentSessionStatus({
        txnRef: result.txnRef,
        status: "expired",
        responseCode: result.responseCode || "TIMEOUT",
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
        payDate: result.payDate
      });
    } catch (error) {
      if (isConditionalCheckFailedError(error)) {
        this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=finalized_during_expiry source=${source}`);
        return;
      }

      throw error;
    }

    this.logger.warn(`[payment-vnpay] expired txnRef=${result.txnRef} source=${source} expiresAt=${session.expiresAt}`);
    if (!session.email) {
      this.logger.warn(`[mail-ses] payment_expired_skipped txnRef=${result.txnRef} source=${source} reason=missing_session_email`);
      return;
    }

    const resolvedOrderInfo = session.orderInfo || result.orderInfo;
    const requestId = extractCheckoutGateRequestId(resolvedOrderInfo);
    if (requestId) {
      await releaseCheckoutGateReservation({
        requestId,
        message: PAYMENT_TIMEOUT_MESSAGE,
        failureCode: "payment_expired"
      });
    }

    await this.enqueueFailedPaymentNotification({
      email: session.email,
      txnRef: result.txnRef,
      amount: result.amount || session.amount,
      orderInfo: resolvedOrderInfo,
      requestId,
      responseCode: result.responseCode || "TIMEOUT",
      transactionNo: result.transactionNo,
      bankCode: result.bankCode,
      payDate: result.payDate,
      failureReason: PAYMENT_TIMEOUT_MESSAGE
    }, source);
  }

  private async finalizeFailedPayment(
    session: PaymentSessionRecord,
    result: VnpayReturnPayload,
    source: "return" | "ipn",
    failureReason: string
  ) {
    try {
      await updatePaymentSessionStatus({
        txnRef: result.txnRef,
        status: "failed",
        responseCode: result.responseCode,
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
        payDate: result.payDate
      });
    } catch (error) {
      if (isConditionalCheckFailedError(error)) {
        this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=finalized_during_failure source=${source}`);
        return;
      }
      throw error;
    }

    if (session.email) {
      const resolvedOrderInfo = session.orderInfo || result.orderInfo;
      const requestId = extractCheckoutGateRequestId(resolvedOrderInfo);
      if (requestId) {
        await releaseCheckoutGateReservation({
          requestId,
          message: failureReason,
          failureCode: result.responseCode === "24" ? "payment_cancelled" : "payment_failed"
        });
      }

      await this.enqueueFailedPaymentNotification({
        email: session.email,
        txnRef: result.txnRef,
        amount: result.amount || session.amount,
        orderInfo: resolvedOrderInfo,
        requestId,
        responseCode: result.responseCode,
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
        payDate: result.payDate,
        failureReason
      }, source);
    } else {
      this.logger.warn(`[mail-ses] payment_failed_skipped txnRef=${result.txnRef} source=${source} reason=missing_session_email`);
    }

    this.logger.warn(`[queue-payment] skipped txnRef=${result.txnRef} reason=status_${result.transactionStatus} source=${source}`);
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
      await this.notificationsService.publishPaymentFailedEvent(input);
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
    }
  }

  private async publishPaymentCompletedEventSafely(
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
    try {
      await this.notificationsService.publishPaymentCompletedEvent(input);
    } catch (error) {
      logQueueWarn(this.logger, {
        queue: "paymentEvents",
        eventType: "payment.completed",
        status: "enqueue_failed",
        txnRef: input.txnRef,
        message: error instanceof Error ? error.message : "unknown"
      });
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
