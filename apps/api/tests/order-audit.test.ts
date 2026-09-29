import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrderAuditRecord, parseOrderAuditMessage, type OrderStreamRecord } from "../src/modules/storefront/order-audit.ts";
import { publishOrderAuditRecords } from "../src/entrypoints/lambda/streams/order-audit.ts";
import { processOrderAuditMessages } from "../src/entrypoints/lambda/queue/order-audit-worker.ts";

function orderEvent(eventName: string, oldStatus?: string, status?: string): OrderStreamRecord {
  return {
    eventID: "shard:42",
    eventName,
    dynamodb: {
      Keys: { PK: { S: "ORDER#order-1" }, SK: { S: "ORDER" } },
      ...(oldStatus ? { OldImage: { status: { S: oldStatus } } } : {}),
      ...(status ? { NewImage: { status: { S: status } } } : {}),
      SequenceNumber: "42",
      ApproximateCreationDateTime: 1720000000
    }
  };
}

test("audit logs order INSERT with a deterministic key and without customer data", () => {
  const audit = buildOrderAuditRecord(orderEvent("INSERT", undefined, "awaiting_payment"));
  assert.equal(audit?.PK, "AUDIT_LOG_ORDER#order-1");
  assert.match(audit?.SK ?? "", /^EVENT#.*#shard:42$/);
  assert.equal(audit?.changeType, "ORDER_STATUS");
  assert.equal(audit?.eventName, "INSERT");
  assert.equal(audit?.before, null);
  assert.equal(audit?.after, "awaiting_payment");
  assert.deepEqual(Object.keys(audit ?? {}).sort(), ["PK", "SK", "entityType", "orderId", "changeType", "eventName", "before", "after", "actor", "context", "occurredAt", "sourceSK", "sourceEventId", "sourceSequenceNumber"].sort());
  assert.deepEqual(audit?.actor, { type: "SERVICE", id: "unknown", role: "SYSTEM" });
  assert.deepEqual(audit?.context, { source: "UNKNOWN", auditWriter: "lambda:supermarket-order-audit-stream" });
  assert.equal(audit?.sourceSK, "ORDER");
  assert.equal(audit?.sourceEventId, "shard:42");
  assert.equal(audit?.sourceSequenceNumber, "42");
  assert.equal(JSON.stringify(audit).includes("customerEmail"), false);
});

test("audit copies actor metadata from the changed source item", () => {
  const event = orderEvent("MODIFY", "awaiting_payment", "paid");
  event.dynamodb!.NewImage = {
    ...event.dynamodb!.NewImage,
    auditActorType: { S: "SERVICE" },
    auditActorId: { S: "lambda:vnpay-ipn" },
    auditActorRole: { S: "SYSTEM" },
    auditSource: { S: "VNPAY_IPN" },
    auditReason: { S: "payment_success" },
    auditRequestId: { S: "order-1" }
  };
  const audit = buildOrderAuditRecord(event)!;
  assert.deepEqual(audit.actor, { type: "SERVICE", id: "lambda:vnpay-ipn", role: "SYSTEM" });
  assert.deepEqual(audit.context, {
    source: "VNPAY_IPN",
    reason: "payment_success",
    requestId: "order-1",
    auditWriter: "lambda:supermarket-order-audit-stream"
  });
});

test("audit logs only status changes for MODIFY", () => {
  assert.equal(buildOrderAuditRecord(orderEvent("MODIFY", "paid", "paid")), null);
  const audit = buildOrderAuditRecord(orderEvent("MODIFY", "awaiting_payment", "paid"));
  assert.equal(audit?.eventName, "MODIFY");
  assert.equal(audit?.before, "awaiting_payment");
  assert.equal(audit?.after, "paid");
});

test("audit logs REMOVE and ignores order items and audit records", () => {
  const removed = buildOrderAuditRecord(orderEvent("REMOVE", "paid"))!;
  assert.equal(removed.eventName, "REMOVE");
  assert.equal(removed.before, "paid");
  assert.equal(removed.after, null);
  assert.deepEqual(parseOrderAuditMessage(JSON.stringify(removed)), removed);
  const orderItem = orderEvent("INSERT", undefined, "pending");
  orderItem.dynamodb!.Keys!.SK = { S: "ORDER_ITEM#product-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
  orderItem.dynamodb!.Keys!.PK = { S: "AUDIT_LOG_ORDER#order-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
});

function paymentEvent(eventName: string, oldStatus?: string, status?: string, orderId?: string): OrderStreamRecord {
  const image = (paymentStatus: string) => ({
    entityType: { S: "PAYMENT_SESSION" },
    txnRef: { S: "txn-1" },
    ...(orderId ? { orderId: { S: orderId } } : {}),
    orderInfo: { S: "Payment for order 45d73815-a88c-4ad8-a649-3736b6d822d8" },
    status: { S: paymentStatus }
  });
  return {
    eventID: `payment:${eventName}:${oldStatus ?? "none"}:${status ?? "none"}`,
    eventName,
    dynamodb: {
      Keys: { PK: { S: "PAYMENT#txn-1" }, SK: { S: "DETAIL" } },
      ...(oldStatus ? { OldImage: image(oldStatus) } : {}),
      ...(status ? { NewImage: image(status) } : {}),
      SequenceNumber: "99",
      ApproximateCreationDateTime: 1720000001
    }
  };
}

test("payment session changes use flat before/after fields in the same order history", () => {
  const orderId = "order-1";
  const inserted = buildOrderAuditRecord(paymentEvent("INSERT", undefined, "pending", orderId))!;
  assert.equal(inserted.PK, `AUDIT_LOG_ORDER#${orderId}`);
  assert.equal(inserted.changeType, "PAYMENT_STATUS");
  assert.equal(inserted.eventName, "INSERT");
  assert.equal(inserted.paymentTxnRef, "txn-1");
  assert.equal(inserted.sourceSK, "DETAIL");
  assert.equal(inserted.before, null);
  assert.equal(inserted.after, "pending");
  assert.deepEqual(parseOrderAuditMessage(JSON.stringify(inserted)), inserted);

  const paid = buildOrderAuditRecord(paymentEvent("MODIFY", "pending", "success", orderId))!;
  assert.equal(paid.eventName, "MODIFY");
  assert.equal(paid.before, "pending");
  assert.equal(paid.after, "success");
  assert.equal(buildOrderAuditRecord(paymentEvent("MODIFY", "success", "success", orderId)), null);
  assert.throws(() => parseOrderAuditMessage(JSON.stringify({ ...paid, paymentTxnRef: undefined })));
  assert.throws(() => parseOrderAuditMessage(JSON.stringify({ ...paid, before: "success" })));
});

test("legacy linked payment sessions are audited, standalone sessions are skipped", () => {
  const legacy = buildOrderAuditRecord(paymentEvent("MODIFY", "pending", "failed"));
  assert.equal(legacy?.orderId, "45d73815-a88c-4ad8-a649-3736b6d822d8");
  assert.ok(legacy);
  const oldQueueMessage = {
    PK: legacy.PK, SK: legacy.SK, entityType: legacy.entityType,
    orderId: legacy.orderId, sourcePK: "PAYMENT#txn-1", sourceSK: "DETAIL",
    paymentTxnRef: "txn-1", changeType: "PAYMENT_STATUS",
    changes: { paymentStatus: { before: "pending", after: "failed" } },
    eventName: "MODIFY", previousStatus: "pending", status: "failed",
    occurredAt: legacy.occurredAt,
    sourceEventId: "payment:MODIFY:pending:failed", sourceSequenceNumber: "99"
  };
  assert.deepEqual(parseOrderAuditMessage(JSON.stringify(oldQueueMessage)), legacy);
  const standalone = paymentEvent("INSERT", undefined, "pending");
  standalone.dynamodb!.NewImage!.orderInfo = { S: "Standalone payment" };
  assert.equal(buildOrderAuditRecord(standalone), null);
});

test("publisher retries failed Stream records and skips non-status changes", async () => {
  const unchanged = orderEvent("MODIFY", "paid", "paid");
  unchanged.dynamodb!.SequenceNumber = "41";
  const changed = orderEvent("MODIFY", "paid", "refund_pending");
  const published: string[] = [];
  const response = await publishOrderAuditRecords({ Records: [unchanged, changed] }, async (audit) => {
    published.push(audit.SK);
    throw new Error("SQS unavailable");
  });
  assert.match(published[0] ?? "", /#shard:42$/);
  assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "42" }]);
});

test("worker retries failed FIFO message and all later messages", async () => {
  const first = buildOrderAuditRecord(orderEvent("INSERT", undefined, "awaiting_payment"))!;
  const second = buildOrderAuditRecord(orderEvent("MODIFY", "awaiting_payment", "paid"))!;
  const writes: string[] = [];
  const response = await processOrderAuditMessages({ Records: [
    { messageId: "one", body: JSON.stringify(first) },
    { messageId: "two", body: JSON.stringify(second) },
    { messageId: "three", body: JSON.stringify(second) }
  ] }, async (audit) => {
    writes.push(audit.after ?? "removed");
    if (audit.after === "paid") throw new Error("DynamoDB unavailable");
  });
  assert.deepEqual(writes, ["awaiting_payment", "paid"]);
  assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "two" }, { itemIdentifier: "three" }]);
});

test("worker accepts idempotent duplicate and rejects a forged queue identity", async () => {
  const audit = buildOrderAuditRecord(orderEvent("INSERT", undefined, "awaiting_payment"))!;
  const duplicate = new Error("Already recorded");
  duplicate.name = "ConditionalCheckFailedException";
  const response = await processOrderAuditMessages({ Records: [
    { messageId: "one", body: JSON.stringify(audit) },
    { messageId: "two", body: JSON.stringify(audit) }
  ] }, async () => { throw duplicate; });
  assert.deepEqual(response.batchItemFailures, []);
  assert.throws(() => parseOrderAuditMessage(JSON.stringify({ ...audit, PK: "ORDER#another-order" })));
  assert.throws(() => parseOrderAuditMessage(JSON.stringify({ ...audit, sourceEventId: "another-event" })));
  assert.throws(() => parseOrderAuditMessage(JSON.stringify({ ...audit, before: "paid" })));
  const legacyMessage = {
    PK: audit.PK, SK: audit.SK, entityType: audit.entityType,
    orderId: audit.orderId, sourceSK: "ORDER", eventName: "INSERT",
    status: audit.after, occurredAt: audit.occurredAt,
    sourceEventId: "shard:42", sourceSequenceNumber: "42"
  };
  assert.deepEqual(parseOrderAuditMessage(JSON.stringify(legacyMessage)), audit);
});
