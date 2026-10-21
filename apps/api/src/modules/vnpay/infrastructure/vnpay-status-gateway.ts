import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentStatusGateway, RecoverablePayment } from "../application/ports/payment-recovery-ports.js";
import type { RuntimeConfigService } from "../../../config/runtime-config.service.js";

const checksum = (values: string[], secret: string) => createHmac("sha512", secret).update(values.join("|"), "utf8").digest("hex");

export class VnpayStatusGateway implements PaymentStatusGateway {
  constructor(private readonly config: () => ReturnType<RuntimeConfigService["getPaymentConfig"]>) {}
  async query(session: RecoverablePayment) {
    const config = this.config();
    if (!session.transactionDate || !/^\d{14}$/.test(session.transactionDate)) throw new Error("Original transaction date unavailable");
    if (!config.vnpayHashSecret || !config.vnpayTmnCode) throw new Error("VNPay credentials are not configured");
    const url = config.vnpayTransactionUrl || (new URL(config.vnpayPaymentUrl).hostname === "sandbox.vnpayment.vn"
      ? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction" : "");
    if (!url || new URL(url).protocol !== "https:") throw new Error("VNPAY_TRANSACTION_URL must use HTTPS");
    const body: Record<string, string> = { vnp_RequestId: randomBytes(16).toString("hex"), vnp_Version: "2.1.0",
      vnp_Command: "querydr", vnp_TmnCode: config.vnpayTmnCode, vnp_TxnRef: session.txnRef,
      vnp_TransactionDate: session.transactionDate,
      vnp_CreateDate: new Date(Date.now() + 7 * 3600000).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
      vnp_IpAddr: config.vnpayMerchantIp || "127.0.0.1", vnp_OrderInfo: `Query payment ${session.txnRef}` };
    body.vnp_SecureHash = checksum([body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode,
      body.vnp_TxnRef, body.vnp_TransactionDate, body.vnp_CreateDate, body.vnp_IpAddr, body.vnp_OrderInfo], config.vnpayHashSecret);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`VNPay query HTTP ${response.status}`);
    const raw = await response.json() as Record<string, unknown>;
    const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
    const signature = value("vnp_SecureHash");
    const fields = ["ResponseId", "Command", "ResponseCode", "Message", "TmnCode", "TxnRef", "Amount", "BankCode", "PayDate",
      "TransactionNo", "TransactionType", "TransactionStatus", "OrderInfo", "PromotionCode", "PromotionAmount"];
    const expected = checksum(fields.map(field => value(`vnp_${field}`)), config.vnpayHashSecret);
    if (!/^[a-fA-F0-9]{128}$/.test(signature) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex")) ||
      value("vnp_Command") !== "querydr" || value("vnp_TmnCode") !== config.vnpayTmnCode || value("vnp_TxnRef") !== session.txnRef) {
      throw new Error("Invalid signed VNPay query response");
    }
    // Query success does NOT mean payment success. Never interpret refund or
    // pending/unknown outcomes as an unsuccessful original payment.
    if (value("vnp_ResponseCode") !== "00" || value("vnp_TransactionType") !== "01" || value("vnp_TransactionStatus") !== "00") return null;
    if (!Number.isSafeInteger(session.amount * 100) || value("vnp_Amount") !== String(session.amount * 100) ||
      !/^\d{1,15}$/.test(value("vnp_TransactionNo")) || !/^\d{14}$/.test(value("vnp_PayDate"))) {
      throw new Error("VNPay query payment correlation mismatch");
    }
    return { txnRef: session.txnRef, amountMinor: value("vnp_Amount"), transactionStatus: "success" as const,
      responseCode: "00", gatewayTransactionStatus: "00", transactionNo: value("vnp_TransactionNo"),
      bankCode: value("vnp_BankCode"), payDate: value("vnp_PayDate") };
  }
}
