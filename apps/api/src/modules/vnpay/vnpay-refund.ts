import crypto from "node:crypto";
import type { PaymentSessionRecord } from "./vnpay.repository.js";

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnpDate(value: Date): string {
  const date = new Date(value.getTime() + VIETNAM_OFFSET_MS);
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function checksum(values: string[], secret: string): string {
  return crypto.createHmac("sha512", secret).update(values.join("|"), "utf8").digest("hex");
}

function verifyChecksum(values: string[], signature: unknown, secret: string): boolean {
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  return crypto.timingSafeEqual(Buffer.from(checksum(values, secret), "hex"), Buffer.from(signature, "hex"));
}

export type RefundGatewayResult = {
  responseCode: string;
  transactionStatus: string;
  transactionNo: string;
  transactionType: string;
};

export async function sendVnpayRefund(input: {
  session: PaymentSessionRecord;
  requestId: string;
  secret: string;
  tmnCode: string;
  paymentUrl: string;
  transactionUrl?: string;
  merchantIp?: string;
  orderId: string;
}): Promise<RefundGatewayResult> {
  const { session } = input;
  if (session.status !== "success" || !session.transactionNo || !/^\d{1,15}$/.test(session.transactionNo)) {
    throw new Error("Payment is not confirmed for refund");
  }
  if (!session.transactionDate || !/^\d{14}$/.test(session.transactionDate)) {
    throw new Error("Original payment creation time is unavailable for refund");
  }
  const amount = session.amount * 100;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999) throw new Error("Invalid refund amount");

  const paymentHost = new URL(input.paymentUrl).hostname;
  const url = input.transactionUrl || (paymentHost === "sandbox.vnpayment.vn"
    ? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction" : "");
  if (!url || new URL(url).protocol !== "https:") throw new Error("VNPAY_TRANSACTION_URL must be configured for this merchant");

  const body: Record<string, string> = {
    vnp_RequestId: input.requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: input.tmnCode,
    vnp_TransactionType: "02",
    vnp_TxnRef: session.txnRef,
    vnp_Amount: String(amount),
    vnp_TransactionNo: session.transactionNo,
    vnp_TransactionDate: session.transactionDate,
    vnp_CreateBy: "customer",
    vnp_CreateDate: vnpDate(new Date()),
    vnp_IpAddr: input.merchantIp || "127.0.0.1",
    vnp_OrderInfo: `Refund order ${input.orderId}`
  };
  body.vnp_SecureHash = checksum([
    body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode,
    body.vnp_TransactionType, body.vnp_TxnRef, body.vnp_Amount, body.vnp_TransactionNo,
    body.vnp_TransactionDate, body.vnp_CreateBy, body.vnp_CreateDate, body.vnp_IpAddr,
    body.vnp_OrderInfo
  ], input.secret);

  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`VNPAY refund HTTP ${response.status}`);
  const raw = await response.json() as Record<string, unknown>;
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const signed = [
    value("vnp_ResponseId"), value("vnp_Command"), value("vnp_ResponseCode"), value("vnp_Message"),
    value("vnp_TmnCode"), value("vnp_TxnRef"), value("vnp_Amount"), value("vnp_BankCode"),
    value("vnp_PayDate"), value("vnp_TransactionNo"), value("vnp_TransactionType"),
    value("vnp_TransactionStatus"), value("vnp_OrderInfo")
  ];
  if (!verifyChecksum(signed, raw.vnp_SecureHash, input.secret)
    || value("vnp_TmnCode") !== input.tmnCode
    || value("vnp_TxnRef") !== session.txnRef
    || value("vnp_Amount") !== String(amount)
    || value("vnp_TransactionType") !== "02") {
    throw new Error("Invalid VNPAY refund response");
  }
  return {
    responseCode: value("vnp_ResponseCode"), transactionStatus: value("vnp_TransactionStatus"),
    transactionNo: value("vnp_TransactionNo"), transactionType: value("vnp_TransactionType")
  };
}

export async function queryVnpayRefund(input: {
  session: PaymentSessionRecord;
  refundTransactionNo?: string;
  secret: string;
  tmnCode: string;
  paymentUrl: string;
  transactionUrl?: string;
  merchantIp?: string;
}): Promise<RefundGatewayResult | null> {
  if (!sessionDateIsValid(input.session)) return null;
  const paymentHost = new URL(input.paymentUrl).hostname;
  const url = input.transactionUrl || (paymentHost === "sandbox.vnpayment.vn"
    ? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction" : "");
  if (!url || new URL(url).protocol !== "https:") throw new Error("VNPAY_TRANSACTION_URL must be configured for this merchant");
  const body: Record<string, string> = {
    vnp_RequestId: crypto.randomBytes(16).toString("hex"), vnp_Version: "2.1.0",
    vnp_Command: "querydr", vnp_TmnCode: input.tmnCode,
    vnp_TxnRef: input.session.txnRef, vnp_OrderInfo: `Query refund ${input.session.txnRef}`,
    vnp_TransactionDate: input.session.transactionDate!, vnp_CreateDate: vnpDate(new Date()),
    vnp_IpAddr: input.merchantIp || "127.0.0.1"
  };
  if (input.refundTransactionNo && /^\d{1,15}$/.test(input.refundTransactionNo)) {
    body.vnp_TransactionNo = input.refundTransactionNo;
  }
  body.vnp_SecureHash = checksum([
    body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode,
    body.vnp_TxnRef, body.vnp_TransactionDate, body.vnp_CreateDate, body.vnp_IpAddr,
    body.vnp_OrderInfo
  ], input.secret);
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`VNPAY query HTTP ${response.status}`);
  const raw = await response.json() as Record<string, unknown>;
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const signed = [
    value("vnp_ResponseId"), value("vnp_Command"), value("vnp_ResponseCode"), value("vnp_Message"),
    value("vnp_TmnCode"), value("vnp_TxnRef"), value("vnp_Amount"), value("vnp_BankCode"),
    value("vnp_PayDate"), value("vnp_TransactionNo"), value("vnp_TransactionType"),
    value("vnp_TransactionStatus"), value("vnp_OrderInfo"), value("vnp_PromotionCode"),
    value("vnp_PromotionAmount")
  ];
  if (!verifyChecksum(signed, raw.vnp_SecureHash, input.secret)
    || value("vnp_TmnCode") !== input.tmnCode || value("vnp_TxnRef") !== input.session.txnRef) {
    throw new Error("Invalid VNPAY query response");
  }
  if (value("vnp_ResponseCode") !== "00" || value("vnp_TransactionType") !== "02"
    || value("vnp_Amount") !== String(input.session.amount * 100)
    || (input.refundTransactionNo && value("vnp_TransactionNo") !== input.refundTransactionNo)) return null;
  return {
    responseCode: value("vnp_ResponseCode"), transactionStatus: value("vnp_TransactionStatus"),
    transactionNo: value("vnp_TransactionNo"), transactionType: value("vnp_TransactionType")
  };
}

function sessionDateIsValid(session: PaymentSessionRecord): boolean {
  return Boolean(session.transactionDate && /^\d{14}$/.test(session.transactionDate));
}
