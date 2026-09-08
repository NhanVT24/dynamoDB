import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { Module, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import Fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

Object.assign(process.env, {
  VNPAY_TMN_CODE: "TEST0001", VNPAY_HASH_SECRET: "local-test-only-secret",
  VNPAY_RETURN_URL: "http://localhost/result", VNPAY_IPN_URL: "http://localhost/ipn",
  DYNAMODB_ENDPOINT: "http://127.0.0.1:1"
});
const { VnpayService } = await import("../dist/src/modules/vnpay/vnpay.service.js");
const { VnpayController } = await import("../dist/src/modules/vnpay/vnpay.controller.js");
const { verifyVnpaySignature, serializeVnpayParams } = await import("../dist/src/modules/vnpay/vnpay-signature.js");
const { rawDb } = await import("../dist/src/database/dynamodb/client.js");
const secret = process.env.VNPAY_HASH_SECRET;
const config = { getPaymentConfig: () => ({ vnpayTmnCode: "TEST0001", vnpayHashSecret: secret }) };
let record, updates, events, failPublish, failRead, failMark, publishingDisabled;
const base = {
  vnp_Amount: "10000000", vnp_BankCode: "NCB", vnp_OrderInfo: "Thanh toan + order & 100%",
  vnp_PayDate: "20260908170000", vnp_ResponseCode: "00", vnp_TmnCode: "TEST0001",
  vnp_TransactionNo: "123456", vnp_TransactionStatus: "00", vnp_TxnRef: "NXtest1"
};
// Independent fixture builder; literal serialization is also checked below.
function signed(overrides = {}) {
  const data = { ...base, ...overrides };
  const canonical = Object.keys(data).sort().map((key) => `${key}=${encodeURIComponent(data[key]).replaceAll("%20", "+")}`).join("&");
  return { ...data, vnp_SecureHash: createHmac("sha512", secret).update(canonical).digest("hex") };
}
function conflict() { return Object.assign(new Error("conditional conflict"), { name: "ConditionalCheckFailedException" }); }
const notifications = {
  async publishPaymentCompletedEvent(input) { return publish("success", input); },
  async publishPaymentFailedEvent(input) { return publish("failed", input); }
};
function publish(status, input) {
  if (failPublish) { failPublish = false; throw new Error("EventBridge unavailable"); }
  if (publishingDisabled) return { queued: false };
  events.push({ status, ...input });
  return { queued: true };
}
const service = new VnpayService(notifications, config);
let app, originalSend;
before(async () => {
  Logger.overrideLogger(false);
  originalSend = rawDb.send;
  rawDb.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === "GetItemCommand") {
      if (failRead) throw new Error("DynamoDB unavailable");
      assert.equal(input.ConsistentRead, true);
      return record ? { Item: marshall(structuredClone(record)) } : {};
    }
    assert.equal(command.constructor.name, "UpdateItemCommand", "Unexpected AWS call");
    const values = unmarshall(input.ExpressionAttributeValues);
    if (values[":status"]) {
      assert.equal(input.ConditionExpression, "attribute_exists(PK) AND #status = :pendingStatus");
      assert.equal(input.ReturnValues, "ALL_NEW");
      if (!record || record.status !== "pending") throw conflict();
      updates++;
      for (const [key, value] of Object.entries(values)) {
        if (key !== ":pendingStatus") record[key.slice(1)] = value;
      }
      return { Attributes: marshall(structuredClone(record)) };
    }
    if (failMark) { failMark = false; throw new Error("Marker write failed"); }
    if (record.paymentEventEnqueuedAt) throw conflict();
    record.paymentEventEnqueuedAt = values[":paymentEventEnqueuedAt"];
    return {};
  };
  class TestModule {}
  Module({ controllers: [VnpayController], providers: [{ provide: VnpayService, useValue: service }] })(TestModule);
  app = await NestFactory.create(TestModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
after(async () => { await app?.close(); rawDb.send = originalSend; });
beforeEach(() => {
  record = { PK: "PAYMENT#NXtest1", SK: "DETAIL", entityType: "PAYMENT_SESSION", txnRef: "NXtest1",
    status: "pending", amount: 100000, email: "test@example.com", orderInfo: base.vnp_OrderInfo,
    expiresAt: "2099-01-01T00:00:00.000Z" };
  updates = 0; events = []; failPublish = failRead = failMark = publishingDisabled = false;
});
async function request(query, path = "ipn") {
  const url = `/api/payments/vnpay/${path}?${typeof query === "string" ? query : new URLSearchParams(query)}`;
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  return response.json();
}

test("encoding preserves spaces, literal plus, ampersand, percent and Unicode", () => {
  assert.equal(serializeVnpayParams({ vnp_OrderInfo: "A + B & 100% Việt", vnp_Amount: "100" }),
    "vnp_Amount=100&vnp_OrderInfo=A+%2B+B+%26+100%25+Vi%E1%BB%87t");
});
test("empty portal probe is 97 and does not change payment", async () => {
  assert.equal((await request({})).RspCode, "97");
  assert.equal(verifyVnpaySignature({}, secret).reason, "missing_hash");
  assert.equal(updates, 0);
});
test("tampering with a signed amount is 97", async () => {
  assert.equal((await request({ ...signed(), vnp_Amount: "1" })).RspCode, "97");
  assert.equal(updates, 0);
});
test("non-hex and truncated signatures are rejected", async () => {
  for (const hash of ["123456789", "a".repeat(127), "z".repeat(128)]) {
    assert.equal((await request({ ...signed(), vnp_SecureHash: hash })).RspCode, "97");
  }
});
test("portal-shaped fixture with a 9-character hash cannot be ACKed", async () => {
  const query = { ...base, vnp_TxnRef: "222222", vnp_SecureHashType: "HMACSHA512", vnp_SecureHash: "123456789" };
  delete query.vnp_TransactionStatus;
  assert.equal((await request(query)).RspCode, "97");
  assert.equal(verifyVnpaySignature(query, secret).reason, "invalid_hash_format");
  assert.equal(updates, 0);
});
test("duplicate VNPay keys from HTTP are rejected, not coerced", async () => {
  assert.equal((await request(new URLSearchParams(signed()) + "&vnp_Amount=10000000")).RspCode, "97");
});
test("metadata outside vnp_ does not alter signature; uppercase hex is valid", async () => {
  const query = signed(); query.vnp_SecureHash = query.vnp_SecureHash.toUpperCase();
  assert.equal((await request({ ...query, trace: "abc", vnp_SecureHashType: "HMACSHA512" })).RspCode, "00");
});
test("merchant mismatch cannot update a payment", async () => {
  assert.equal((await request(signed({ vnp_TmnCode: "OTHER001" }))).RspCode, "99");
  assert.equal(updates, 0);
});
test("a signed creation URL is not a payment callback", async () => {
  assert.equal((await request(signed({ vnp_ResponseCode: "", vnp_TransactionStatus: "", vnp_ReturnUrl: "http://localhost/result" }))).RspCode, "99");
  assert.equal(updates, 0);
});
test("a valid signed callback with unknown reference returns 01", async () => {
  record = null;
  assert.equal((await request(signed())).RspCode, "01");
});
test("valid signature with wrong amount returns 04", async () => {
  assert.equal((await request(signed({ vnp_Amount: "9900000" }))).RspCode, "04");
  assert.equal(updates, 0);
});
test("first IPN is 00; duplicate is 02 with one payment transition", async () => {
  assert.equal((await request(signed())).RspCode, "00");
  assert.equal((await request(signed())).RspCode, "02");
  assert.equal(record.status, "success"); assert.equal(updates, 1); assert.equal(events.length, 1);
});
test("return before IPN reads pending, after IPN reads success; return never writes", async () => {
  assert.equal((await request(signed(), "return")).transactionStatus, "pending");
  assert.equal(updates, 0); assert.equal(events.length, 0);
  await request(signed());
  assert.equal((await request(signed(), "return")).transactionStatus, "success");
  assert.equal(updates, 1); assert.equal(events.length, 1);
  const conflictingReturn = await request(signed({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }), "return");
  assert.equal(conflictingReturn.transactionStatus, "success");
  assert.equal(conflictingReturn.responseCode, "00");
});
test("API Gateway REST proxy preserves decoded plus, spaces, ampersand and Unicode", async () => {
  const api = Fastify();
  api.get("/api/payments/vnpay/ipn", (req) => service.verifyIpn(req.query));
  const handler = awsLambdaFastify(api, { pathParameterUsedAsPath: "proxy" });
  const query = signed({ vnp_OrderInfo: "Thanh toán + order & 100%" });
  try {
    const response = await handler({
      resource: "/api/payments/vnpay/{proxy+}", path: "/api/payments/vnpay/ipn",
      httpMethod: "GET", headers: { Host: "example.execute-api.ap-southeast-1.amazonaws.com" },
      queryStringParameters: query,
      multiValueQueryStringParameters: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, [value]])),
      pathParameters: { proxy: "api/payments/vnpay/ipn" },
      requestContext: { stage: "prod", identity: { sourceIp: "127.0.0.1" } },
      body: null, isBase64Encoded: false
    }, {});
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).RspCode, "00");
  } finally { await api.close(); }
});
test("successful IPN does not require browser return or notification email", async () => {
  delete record.email;
  assert.equal((await request(signed())).RspCode, "00");
  assert.equal(record.status, "success"); assert.equal(updates, 1); assert.equal(events.length, 0);
});
test("late IPN preserves payment success after local session expiry", async () => {
  record.expiresAt = "2000-01-01T00:00:00.000Z";
  assert.equal((await request(signed())).RspCode, "00");
  assert.equal(record.status, "success"); assert.equal(events[0].status, "success");
});
test("legacy finalized expired session is flagged for reconciliation, not silently ACKed", async () => {
  record.status = "expired";
  assert.equal((await request(signed())).RspCode, "99");
  assert.equal(updates, 0);
});
test("checkout with missing customer email records payment then requires reconciliation", async () => {
  delete record.email;
  record.orderInfo = "Checkout 7f5cab62-4426-4099-a00f-4387fd9acea0";
  assert.equal((await request(signed())).RspCode, "99");
  assert.equal(record.status, "success");
  assert.equal(record.paymentEventEnqueuedAt, undefined);
});
test("ResponseCode 00 with TransactionStatus 02 is recorded as failed and ACKed", async () => {
  assert.equal((await request(signed({ vnp_TransactionStatus: "02" }))).RspCode, "00");
  assert.equal(record.status, "failed"); assert.equal(events[0].status, "failed");
});
test("success publish failure is 99; retry resumes dispatch before 02", async () => {
  failPublish = true;
  assert.equal((await request(signed())).RspCode, "99");
  assert.equal(record.status, "success"); assert.equal(record.paymentEventEnqueuedAt, undefined);
  assert.equal((await request(signed())).RspCode, "02");
  assert.equal(events.length, 1); assert.equal(updates, 1);
});
test("failure publish failure also resumes on retry", async () => {
  failPublish = true;
  const query = signed({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02", vnp_TransactionNo: "0" });
  assert.equal((await request(query)).RspCode, "99");
  assert.equal((await request(query)).RspCode, "02");
  assert.equal(events.length, 1); assert.equal(record.status, "failed");
});
test("disabled publishing is 99, never a false enqueue marker", async () => {
  publishingDisabled = true;
  assert.equal((await request(signed())).RspCode, "99");
  assert.equal(record.paymentEventEnqueuedAt, undefined);
});
test("DynamoDB read failure becomes protocol ACK 99, not HTTP 500", async () => {
  failRead = true;
  assert.equal((await request(signed())).RspCode, "99");
});
test("simultaneous IPNs finalize once; delivery is at least once", async () => {
  const results = await Promise.all([service.verifyIpn(signed()), service.verifyIpn(signed())]);
  assert.deepEqual(results.map((r) => r.RspCode).sort(), ["00", "02"]);
  assert.equal(updates, 1); assert.equal(record.status, "success");
  assert.ok(events.length >= 1);
});
test("marker failure permits redelivery without another payment transition", async () => {
  failMark = true;
  assert.equal((await request(signed())).RspCode, "99");
  assert.equal((await request(signed())).RspCode, "02");
  assert.equal(updates, 1); assert.equal(events.length, 2);
});
test("conflicting signed callback cannot overwrite an already paid transaction", async () => {
  await request(signed());
  assert.equal((await request(signed({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))).RspCode, "99");
  assert.equal(record.status, "success"); assert.equal(updates, 1);
});
