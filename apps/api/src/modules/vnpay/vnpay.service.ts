import crypto from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { Injectable, Logger } from "@nestjs/common";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { getStorefrontProductById } from "../storefront/storefront.repository.js";
import {
  createPaymentSession,
  getPaymentSessionByTxnRef,
  markPaymentEventEnqueued,
  updatePaymentSessionStatus
} from "./vnpay.repository.js";
import type { CreateVnpayPaymentInput } from "./vnpay.schema.js";

type VnpayReturnPayload = {
  isValidSignature: boolean;
  transactionStatus: "success" | "failed";
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
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
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
        throw new Error(`Không tìm thấy sản phẩm ${item.productId}.`);
      }

      if (Number(product.stock ?? 0) < item.quantity) {
        throw new Error(`Sản phẩm ${product.name} hiện không đủ số lượng.`);
      }

      totalAmount += Number(product.price ?? 0) * item.quantity;
    }

    const txnRef = `NX${Date.now()}`;
    const createDate = formatVnpDate(new Date());
    const orderInfo = input.orderDescription?.trim() || `Thanh toán đơn hàng ${txnRef}`;
    const resolvedIpAddress = ipAddress || "127.0.0.1";
    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: paymentConfig.vnpayTmnCode,
      vnp_Amount: String(totalAmount * 100),
      vnp_CreateDate: createDate,
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
      amount: totalAmount
    });

    this.logger.log(`payment.created txnRef=${txnRef} amount=${totalAmount} itemCount=${input.items.length} ip=${resolvedIpAddress}`);

    if (input.email?.trim()) {
      const normalizedEmail = input.email.trim().toLowerCase();

      await this.notificationsService.createPendingNotification({
        email: normalizedEmail,
        channel: "system",
        title: "Thanh toán đang chờ xử lý",
        message: `Phiên thanh toán ${txnRef} đã được tạo và đang chờ hoàn tất trên VNPay.`,
        metadata: {
          txnRef,
          amount: totalAmount,
          orderInfo
        }
      });
      this.logger.log(`payment.notification_enqueued txnRef=${txnRef} channel=system email=${normalizedEmail}`);

      await this.notificationsService.createPendingNotification({
        email: normalizedEmail,
        channel: "email",
        title: "Email thanh toán đang chờ gửi",
        message: `Hệ thống đã xếp hàng email hướng dẫn thanh toán cho phiên ${txnRef}.`,
        metadata: {
          txnRef,
          template: "payment-pending"
        }
      });
      this.logger.log(`payment.notification_enqueued txnRef=${txnRef} channel=email email=${normalizedEmail}`);

      await this.notificationsService.publishAuditLog({
        eventType: "payments.vnpay.created",
        email: normalizedEmail,
        resourceId: txnRef,
        metadata: {
          amount: totalAmount,
          itemCount: input.items.length,
          bankCode: input.bankCode ?? "",
          status: "pending"
        }
      });
      this.logger.log(`payment.audit_enqueued txnRef=${txnRef} email=${normalizedEmail}`);
    }

    return {
      paymentUrl,
      txnRef,
      amount: totalAmount,
      orderInfo
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

    this.logger.log(`payment.return_checked txnRef=${query.vnp_TxnRef || ""} valid=${isValidSignature} responseCode=${responseCode}`);
    await this.handleSuccessfulPaymentEvent(result, "return");
    return result;
  }

  async verifyIpn(rawQuery: Record<string, unknown>) {
    const result = await this.verifyReturn(rawQuery);
    this.logger.log(`payment.ipn_checked txnRef=${result.txnRef} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    return result.isValidSignature
      ? { RspCode: "00", Message: "Confirm Success" }
      : { RspCode: "97", Message: "Invalid Checksum" };
  }

  private async handleSuccessfulPaymentEvent(result: VnpayReturnPayload, source: "return" | "ipn") {
    this.logger.log(`payment.queue.evaluate txnRef=${result.txnRef} source=${source} valid=${result.isValidSignature} status=${result.transactionStatus}`);

    if (!result.isValidSignature) {
      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=invalid_signature source=${source}`);
      return;
    }

    const session = result.txnRef ? await getPaymentSessionByTxnRef(result.txnRef) : null;
    if (!session) {
      this.logger.warn(`payment.session.missing txnRef=${result.txnRef} source=${source}`);
      return;
    }

    await updatePaymentSessionStatus({
      txnRef: result.txnRef,
      status: result.transactionStatus,
      responseCode: result.responseCode,
      transactionNo: result.transactionNo,
      bankCode: result.bankCode,
      payDate: result.payDate
    });
    this.logger.log(`payment.session.updated txnRef=${result.txnRef} status=${result.transactionStatus} source=${source}`);

    if (result.transactionStatus !== "success") {
      const resolvedOrderInfo = session.orderInfo || result.orderInfo;
      const orderIdMatch = resolvedOrderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      const failureReason = result.responseCode === "24"
        ? "Khách hàng đã hủy giao dịch trên VNPay."
        : mapResponseCode(result.responseCode);

      if (session.email) {
        await this.notificationsService.publishPaymentFailedEvent({
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
        });
        this.logger.log(`payment.failed_queue.triggered txnRef=${result.txnRef} source=${source}`);
      }

      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=status_${result.transactionStatus} source=${source}`);
      return;
    }

    if (!session.email) {
      this.logger.warn(`payment.queue.skipped txnRef=${result.txnRef} reason=missing_payment_session_email source=${source}`);
      return;
    }

    const resolvedOrderInfo = session.orderInfo || result.orderInfo;
    const orderIdMatch = resolvedOrderInfo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    this.logger.log(`payment.queue.ready txnRef=${result.txnRef} source=${source} orderId=${orderIdMatch?.[0] ?? ""} amount=${result.amount || session.amount}`);

    await this.notificationsService.publishPaymentCompletedEvent({
      email: session.email,
      txnRef: result.txnRef,
      amount: result.amount || session.amount,
      orderInfo: resolvedOrderInfo,
      orderId: orderIdMatch?.[0],
      responseCode: result.responseCode,
      transactionNo: result.transactionNo,
      bankCode: result.bankCode,
      payDate: result.payDate
    });

    try {
      await markPaymentEventEnqueued(result.txnRef);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.log(`payment.queue.already_enqueued txnRef=${result.txnRef} source=${source}`);
        return;
      }

      throw error;
    }

    this.logger.log(`payment.queue.triggered txnRef=${result.txnRef} source=${source}`);
  }
}
