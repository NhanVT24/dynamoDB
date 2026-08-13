import crypto from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Injectable, Logger } from "@nestjs/common";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { sendPaymentFailureEmail } from "../../integrations/ses/order-mailer.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { getStorefrontProductById } from "../storefront/storefront.repository.js";
import {
  createPaymentSession,
  getPaymentSessionByTxnRef,
  markPaymentEventEnqueued,
  updatePaymentSessionStatus,
  type PaymentSessionRecord
} from "./vnpay.repository.js";
import type { CreateVnpayPaymentInput } from "./vnpay.schema.js";

const PAYMENT_TIMEOUT_MINUTES = 5;
const PAYMENT_TIMEOUT_MS = PAYMENT_TIMEOUT_MINUTES * 60 * 1000;
const PAYMENT_TIMEOUT_MESSAGE = `Phien thanh toan da het han sau ${PAYMENT_TIMEOUT_MINUTES} phut.`;
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
  if (code === "00") return "Thanh toan thanh cong.";
  if (code === "24") return "Khach hang da huy giao dich.";
  if (code === "51") return "Tai khoan khong du so du de thanh toan.";
  if (code === "65") return "Tai khoan da vuot qua han muc giao dich trong ngay.";
  if (code === "75") return "Ngan hang thanh toan dang bao tri hoac khong phan hoi.";
  return "Giao dich chua hoan tat hoac da xay ra loi trong qua trinh thanh toan.";
}

function isPaymentSessionExpired(session: Pick<PaymentSessionRecord, "expiresAt">) {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

@Injectable()
export class VnpayService {
  private readonly logger = new Logger(VnpayService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly runtimeConfigService: RuntimeConfigService
  ) {}

  async createPaymentUrl(input: CreateVnpayPaymentInput, ipAddress: string) {
    const paymentConfig = this.runtimeConfigService.getPaymentConfig();
    let totalAmount = 0;

    for (const item of input.items) {
      const product = await getStorefrontProductById(item.productId);
      if (!product) {
        throw new Error(`Khong tim thay san pham ${item.productId}.`);
      }

      if (Number(product.stock ?? 0) < item.quantity) {
        throw new Error(`San pham ${product.name} hien khong du so luong.`);
      }

      totalAmount += Number(product.price ?? 0) * item.quantity;
    }

    const txnRef = `NX${Date.now()}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAYMENT_TIMEOUT_MS);
    const createDate = formatVnpDate(createdAt);
    const expireDate = formatVnpDate(expiresAt);
    const orderInfo = input.orderDescription?.trim() || `Thanh toan don hang ${txnRef}`;
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

    this.logger.log(`payment.created txnRef=${txnRef} amount=${totalAmount} itemCount=${input.items.length} ip=${resolvedIpAddress} expiresAt=${expiresAt.toISOString()}`);

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
      message: isValidSignature ? mapResponseCode(responseCode) : "Chu ky phan hoi tu VNPay khong hop le.",
      txnRef: query.vnp_TxnRef || "",
      amount: Number(query.vnp_Amount || 0) / 100,
      orderInfo: query.vnp_OrderInfo || "",
      responseCode,
      transactionNo: query.vnp_TransactionNo || "",
      bankCode: query.vnp_BankCode || "",
      payDate: query.vnp_PayDate || ""
    };

    this.logger.log(`payment.return_checked txnRef=${query.vnp_TxnRef || ""} valid=${isValidSignature} responseCode=${responseCode}`);
    const handled = await this.handlePaymentEvent(result, "return");
    return handled ? { ...result, ...handled } : result;
  }

  async verifyIpn(rawQuery: Record<string, unknown>) {
    const result = await this.verifyReturn(rawQuery);
    this.logger.log(`payment.ipn_checked txnRef=${result.txnRef} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    if (!result.isValidSignature) {
      return { RspCode: "97", Message: "Invalid Checksum" };
    }

    if (result.transactionStatus === "expired") {
      return { RspCode: "00", Message: "Order Expired" };
    }

    return { RspCode: "00", Message: "Confirm Success" };
  }

  private async handlePaymentEvent(result: VnpayReturnPayload, source: "return" | "ipn"): Promise<VnpayHandlingOverride | null> {
    this.logger.log(`payment.queue.evaluate txnRef=${result.txnRef} source=${source} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    if (!result.isValidSignature) {
      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=invalid_signature source=${source}`);
      return null;
    }

    const session = result.txnRef ? await getPaymentSessionByTxnRef(result.txnRef) : null;
    if (!session) {
      this.logger.warn(`payment.session.missing txnRef=${result.txnRef} source=${source}`);
      return {
        transactionStatus: "failed" as const,
        message: "Khong tim thay phien thanh toan."
      };
    }

    if (session.status !== "pending") {
      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=already_finalized_${session.status} source=${source}`);
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
        ? "Khach hang da huy giao dich tren VNPay."
        : mapResponseCode(result.responseCode);

      await this.finalizeFailedPayment(session, result, source, failureReason);
      return {
        transactionStatus: "failed" as const,
        message: failureReason
      };
    }

    if (!session.email) {
      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=missing_payment_session_email source=${source}`);
      return null;
    }

    const resolvedOrderInfo = session.orderInfo || result.orderInfo;
    const orderIdMatch = resolvedOrderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

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
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=finalized_during_success source=${source}`);
        return {
          transactionStatus: "failed" as const,
          message: "Phien thanh toan da duoc chot boi mot callback khac."
        };
      }

      throw error;
    }

    await this.publishPaymentCompletedEventSafely({
      email: session.email,
      txnRef: result.txnRef,
      amount: result.amount || session.amount,
      orderInfo: resolvedOrderInfo,
      orderId: orderIdMatch?.[0],
      responseCode: result.responseCode,
      transactionNo: result.transactionNo,
      bankCode: result.bankCode,
      payDate: result.payDate
    }, source);

    await this.markPaymentEventEnqueuedSafely(result.txnRef, source);
    this.logger.log(`payment.queue.triggered txnRef=${result.txnRef} source=${source}`);
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
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=finalized_during_expiry source=${source}`);
        return;
      }

      throw error;
    }

    this.logger.warn(`payment.expired txnRef=${result.txnRef} source=${source} expiresAt=${session.expiresAt}`);

    if (!session.email) {
      return;
    }

    const resolvedOrderInfo = session.orderInfo || result.orderInfo;
    const orderIdMatch = resolvedOrderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    await this.enqueueFailedPaymentNotification({
      email: session.email,
      txnRef: result.txnRef,
      amount: result.amount || session.amount,
      orderInfo: resolvedOrderInfo,
      orderId: orderIdMatch?.[0],
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
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=finalized_during_failure source=${source}`);
        return;
      }

      throw error;
    }

    if (session.email) {
      const resolvedOrderInfo = session.orderInfo || result.orderInfo;
      const orderIdMatch = resolvedOrderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

      await this.enqueueFailedPaymentNotification({
        email: session.email,
        txnRef: result.txnRef,
        amount: result.amount || session.amount,
        orderInfo: resolvedOrderInfo,
        orderId: orderIdMatch?.[0],
        responseCode: result.responseCode,
        transactionNo: result.transactionNo,
        bankCode: result.bankCode,
        payDate: result.payDate,
        failureReason
      }, source);
    }

    this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=status_${result.transactionStatus} source=${source}`);
  }

  private async enqueueFailedPaymentNotification(
    input: {
      email: string;
      txnRef: string;
      amount: number;
      orderInfo: string;
      orderId?: string;
      responseCode: string;
      transactionNo: string;
      bankCode: string;
      payDate: string;
      failureReason: string;
    },
    source: "return" | "ipn"
  ) {
    try {
      await sendPaymentFailureEmail({
        toEmail: input.email,
        txnRef: input.txnRef,
        totalAmount: input.amount,
        orderInfo: input.orderInfo,
        failureReason: input.failureReason,
        responseCode: input.responseCode,
        bankCode: input.bankCode,
        payDate: input.payDate
      });
      this.logger.log(`payment.failed_email.sent txnRef=${input.txnRef} source=${source} to=${input.email}`);
    } catch (error) {
      this.logger.warn(
        `payment.failed_email.failed txnRef=${input.txnRef} source=${source} to=${input.email} error=${error instanceof Error ? error.message : "unknown"}`
      );
    }

    try {
      await this.notificationsService.publishPaymentFailedEvent(input);
      await this.markPaymentEventEnqueuedSafely(input.txnRef, source);
      this.logger.log(`payment.failed_queue.triggered txnRef=${input.txnRef} source=${source}`);
    } catch (error) {
      this.logger.warn(
        `payment.failed_queue.enqueue_failed txnRef=${input.txnRef} source=${source} error=${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  private async publishPaymentCompletedEventSafely(
    input: {
      email: string;
      txnRef: string;
      amount: number;
      orderInfo: string;
      orderId?: string;
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
      this.logger.warn(
        `payment.completed_queue.enqueue_failed txnRef=${input.txnRef} source=${source} error=${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  private async publishAuditLogSafely(
    input: Parameters<NotificationsService["publishAuditLog"]>[0],
    failureLogMessage: string
  ) {
    try {
      await this.notificationsService.publishAuditLog(input);
      this.logger.log(`payment.audit_enqueued resourceId=${input.resourceId ?? ""} eventType=${input.eventType}`);
    } catch (error) {
      this.logger.warn(`${failureLogMessage} error=${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async markPaymentEventEnqueuedSafely(txnRef: string, source: "return" | "ipn") {
    try {
      await markPaymentEventEnqueued(txnRef);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.log(`payment.queue.already_enqueued txnRef=${txnRef} source=${source}`);
        return;
      }

      throw error;
    }
  }
}
