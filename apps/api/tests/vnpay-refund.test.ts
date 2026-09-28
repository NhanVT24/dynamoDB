import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { sendVnpayRefund } from "../src/modules/vnpay/vnpay-refund.ts";
import type { PaymentSessionRecord } from "../src/modules/vnpay/vnpay.repository.js";

const secret = "test-refund-secret";
const session = {
  txnRef: "NX123", amount: 100000, status: "success", transactionNo: "123456",
  createdAt: "2026-09-28T03:00:00.000Z", transactionDate: "20260928100000"
} as PaymentSessionRecord;

test("refund signs original transaction data and rejects a tampered response", async () => {
  const originalFetch = globalThis.fetch;
  let seenBody: Record<string, string> | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, string>;
      const body = seenBody;
      assert.equal(body.vnp_TransactionDate, session.transactionDate);
      assert.equal(body.vnp_Amount, "10000000");
      const requestFields = ["vnp_RequestId", "vnp_Version", "vnp_Command", "vnp_TmnCode",
        "vnp_TransactionType", "vnp_TxnRef", "vnp_Amount", "vnp_TransactionNo",
        "vnp_TransactionDate", "vnp_CreateBy", "vnp_CreateDate", "vnp_IpAddr", "vnp_OrderInfo"];
      const expectedRequestHash = crypto.createHmac("sha512", secret)
        .update(requestFields.map((field) => body[field]).join("|"), "utf8").digest("hex");
      assert.equal(body.vnp_SecureHash, expectedRequestHash);
      const response: Record<string, string> = {
        vnp_ResponseId: "1", vnp_Command: "refund", vnp_ResponseCode: "00",
        vnp_Message: "Success", vnp_TmnCode: "TESTCODE", vnp_TxnRef: session.txnRef,
        vnp_Amount: body.vnp_Amount, vnp_BankCode: "NCB", vnp_PayDate: "",
        vnp_TransactionNo: "555", vnp_TransactionType: "02", vnp_TransactionStatus: "06",
        vnp_OrderInfo: body.vnp_OrderInfo
      };
      const responseFields = ["vnp_ResponseId", "vnp_Command", "vnp_ResponseCode", "vnp_Message",
        "vnp_TmnCode", "vnp_TxnRef", "vnp_Amount", "vnp_BankCode", "vnp_PayDate",
        "vnp_TransactionNo", "vnp_TransactionType", "vnp_TransactionStatus", "vnp_OrderInfo"];
      response.vnp_SecureHash = crypto.createHmac("sha512", secret)
        .update(responseFields.map((field) => response[field]).join("|"), "utf8").digest("hex");
      return new Response(JSON.stringify(response), { status: 200 });
    };
    const input = { session, requestId: "12345678901234567890123456789012", secret,
      tmnCode: "TESTCODE", paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      orderId: "order-1" };
    assert.equal((await sendVnpayRefund(input)).transactionStatus, "06");
    globalThis.fetch = async () => new Response(JSON.stringify({ vnp_SecureHash: "0".repeat(128) }), { status: 200 });
    await assert.rejects(sendVnpayRefund(input), /Invalid VNPAY refund response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(seenBody);
});
