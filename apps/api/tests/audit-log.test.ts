import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAuditLogRecord, parseAuditLogMessage, type AuditStreamRecord } from "../src/modules/audit-log/audit-log.ts";
import { publishAuditLogRecords } from "../src/entrypoints/lambda/streams/audit-log.ts";
import { processAuditLogMessages } from "../src/entrypoints/lambda/queue/audit-log-worker.ts";

function orderEvent(eventName: string, oldStatus?: string, status?: string): AuditStreamRecord {
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
  const audit = buildAuditLogRecord(orderEvent("INSERT", undefined, "awaiting_payment"));
  assert.equal(audit?.PK, "AUDIT_LOG#ORDER#order-1");
  assert.match(audit?.SK ?? "", /^EVENT#.*#shard:42$/);
  assert.equal(audit?.resourceType, "ORDER");
  assert.equal(audit?.resourceId, "order-1");
  assert.equal(audit?.action, "CREATED");
  assert.equal(audit?.eventName, "INSERT");
  assert.deepEqual(audit?.changes.status, { before: null, after: "awaiting_payment" });
  assert.deepEqual(Object.keys(audit ?? {}).sort(), ["PK", "SK", "entityType", "resourceType", "resourceId", "action", "eventName", "changes", "actor", "context", "occurredAt", "source"].sort());
  assert.deepEqual(audit?.actor, { type: "SERVICE", id: "unknown", role: "SYSTEM" });
  assert.deepEqual(audit?.context, { source: "UNKNOWN", auditWriter: "lambda:supermarket-audit-log-stream" });
  assert.equal(audit?.source.sk, "ORDER");
  assert.equal(audit?.source.eventId, "shard:42");
  assert.equal(audit?.source.sequenceNumber, "42");
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
  const audit = buildAuditLogRecord(event)!;
  assert.deepEqual(audit.actor, { type: "SERVICE", id: "lambda:vnpay-ipn", role: "SYSTEM" });
  assert.deepEqual(audit.context, {
    source: "VNPAY_IPN",
    reason: "payment_success",
    requestId: "order-1",
    auditWriter: "lambda:supermarket-audit-log-stream"
  });
});

test("audit logs only status changes for MODIFY", () => {
  assert.equal(buildAuditLogRecord(orderEvent("MODIFY", "paid", "paid")), null);
  const audit = buildAuditLogRecord(orderEvent("MODIFY", "awaiting_payment", "paid"));
  assert.equal(audit?.eventName, "MODIFY");
  assert.equal(audit?.action, "UPDATED");
  assert.deepEqual(audit?.changes.status, { before: "awaiting_payment", after: "paid" });
});

test("audit logs REMOVE and ignores order items and audit records", () => {
  const removed = buildAuditLogRecord(orderEvent("REMOVE", "paid"))!;
  assert.equal(removed.eventName, "REMOVE");
  assert.equal(removed.action, "DELETED");
  assert.deepEqual(removed.changes.status, { before: "paid", after: null });
  assert.deepEqual(parseAuditLogMessage(JSON.stringify(removed)), removed);
  const orderItem = orderEvent("INSERT", undefined, "pending");
  orderItem.dynamodb!.Keys!.SK = { S: "ORDER_ITEM#product-1" };
  assert.equal(buildAuditLogRecord(orderItem), null);
  orderItem.dynamodb!.Keys!.PK = { S: "AUDIT_LOG#ORDER#order-1" };
  assert.equal(buildAuditLogRecord(orderItem), null);
});

function paymentEvent(eventName: string, oldStatus?: string, status?: string, orderId?: string): AuditStreamRecord {
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
  const inserted = buildAuditLogRecord(paymentEvent("INSERT", undefined, "pending", orderId))!;
  assert.equal(inserted.PK, "AUDIT_LOG#PAYMENT#txn-1");
  assert.equal(inserted.resourceType, "PAYMENT");
  assert.equal(inserted.resourceId, "txn-1");
  assert.equal(inserted.parentResourceId, orderId);
  assert.equal(inserted.eventName, "INSERT");
  assert.equal(inserted.paymentTxnRef, "txn-1");
  assert.equal(inserted.source.sk, "DETAIL");
  assert.deepEqual(inserted.changes.status, { before: null, after: "pending" });
  assert.deepEqual(parseAuditLogMessage(JSON.stringify(inserted)), inserted);

  const paid = buildAuditLogRecord(paymentEvent("MODIFY", "pending", "success", orderId))!;
  assert.equal(paid.eventName, "MODIFY");
  assert.deepEqual(paid.changes.status, { before: "pending", after: "success" });
  assert.equal(buildAuditLogRecord(paymentEvent("MODIFY", "success", "success", orderId)), null);
  assert.throws(() => parseAuditLogMessage(JSON.stringify({ ...paid, paymentTxnRef: undefined })));
  assert.throws(() => parseAuditLogMessage(JSON.stringify({ ...paid, changes: { status: { before: "success", after: "success" } } })));
});

test("legacy linked payment sessions are audited, standalone sessions are skipped", () => {
  const legacy = buildAuditLogRecord(paymentEvent("MODIFY", "pending", "failed"));
  assert.equal(legacy?.parentResourceId, "45d73815-a88c-4ad8-a649-3736b6d822d8");
  assert.ok(legacy);
  const oldQueueMessage = {
    PK: `AUDIT_LOG_ORDER#${legacy.parentResourceId}`, SK: legacy.SK, entityType: "AUDIT_LOG_ORDER",
    orderId: legacy.parentResourceId, sourcePK: "PAYMENT#txn-1", sourceSK: "DETAIL",
    paymentTxnRef: "txn-1", changeType: "PAYMENT_STATUS",
    changes: { paymentStatus: { before: "pending", after: "failed" } },
    eventName: "MODIFY", previousStatus: "pending", status: "failed",
    occurredAt: legacy.occurredAt,
    sourceEventId: "payment:MODIFY:pending:failed", sourceSequenceNumber: "99"
  };
  assert.deepEqual(parseAuditLogMessage(JSON.stringify(oldQueueMessage)), legacy);
  const standalone = paymentEvent("INSERT", undefined, "pending");
  standalone.dynamodb!.NewImage!.orderInfo = { S: "Standalone payment" };
  assert.equal(buildAuditLogRecord(standalone), null);
});

test("publisher retries failed Stream records and skips non-status changes", async () => {
  const unchanged = orderEvent("MODIFY", "paid", "paid");
  unchanged.dynamodb!.SequenceNumber = "41";
  const changed = orderEvent("MODIFY", "paid", "refund_pending");
  const published: string[] = [];
  const response = await publishAuditLogRecords({ Records: [unchanged, changed] }, async (audit) => {
    published.push(audit.SK);
    throw new Error("SQS unavailable");
  });
  assert.match(published[0] ?? "", /#shard:42$/);
  assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "42" }]);
});

test("worker retries failed FIFO message and all later messages", async () => {
  const first = buildAuditLogRecord(orderEvent("INSERT", undefined, "awaiting_payment"))!;
  const second = buildAuditLogRecord(orderEvent("MODIFY", "awaiting_payment", "paid"))!;
  const writes: string[] = [];
  const response = await processAuditLogMessages({ Records: [
    { messageId: "one", body: JSON.stringify(first) },
    { messageId: "two", body: JSON.stringify(second) },
    { messageId: "three", body: JSON.stringify(second) }
  ] }, async (audit) => {
    writes.push(audit.changes.status?.after ?? "removed");
    if (audit.changes.status?.after === "paid") throw new Error("DynamoDB unavailable");
  });
  assert.deepEqual(writes, ["awaiting_payment", "paid"]);
  assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "two" }, { itemIdentifier: "three" }]);
});

test("worker accepts idempotent duplicate and rejects a forged queue identity", async () => {
  const audit = buildAuditLogRecord(orderEvent("INSERT", undefined, "awaiting_payment"))!;
  const duplicate = new Error("Already recorded");
  duplicate.name = "ConditionalCheckFailedException";
  const response = await processAuditLogMessages({ Records: [
    { messageId: "one", body: JSON.stringify(audit) },
    { messageId: "two", body: JSON.stringify(audit) }
  ] }, async () => { throw duplicate; });
  assert.deepEqual(response.batchItemFailures, []);
  assert.throws(() => parseAuditLogMessage(JSON.stringify({ ...audit, PK: "ORDER#another-order" })));
  assert.throws(() => parseAuditLogMessage(JSON.stringify({ ...audit, source: { ...audit.source, eventId: "another-event" } })));
  assert.throws(() => parseAuditLogMessage(JSON.stringify({ ...audit, changes: { status: { before: "paid", after: "paid" } } })));
  const legacyMessage = {
    PK: "AUDIT_LOG_ORDER#order-1", SK: audit.SK, entityType: "AUDIT_LOG_ORDER",
    orderId: audit.resourceId, sourceSK: "ORDER", eventName: "INSERT",
    status: audit.changes.status?.after, occurredAt: audit.occurredAt,
    sourceEventId: "shard:42", sourceSequenceNumber: "42",
    changeType: "ORDER_STATUS"
  };
  assert.deepEqual(parseAuditLogMessage(JSON.stringify(legacyMessage)), audit);
});


