import crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { RuntimeConfigService } from "../../config/runtime-config.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { getStorefrontProductById } from "../storefront/storefront.repository.js";
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
    const orderInfo = input.orderDescription?.trim() || `Thanh toan don hang ${txnRef}`;
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

  verifyReturn(rawQuery: Record<string, unknown>): VnpayReturnPayload {
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

    this.logger.log(`payment.return_checked txnRef=${query.vnp_TxnRef || ""} valid=${isValidSignature} responseCode=${responseCode}`);

    return {
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
  }

  verifyIpn(rawQuery: Record<string, unknown>) {
    const result = this.verifyReturn(rawQuery);
    this.logger.log(`payment.ipn_checked txnRef=${result.txnRef} valid=${result.isValidSignature} status=${result.transactionStatus}`);
    return result.isValidSignature
      ? { RspCode: "00", Message: "Confirm Success" }
      : { RspCode: "97", Message: "Invalid Checksum" };
  }
}
