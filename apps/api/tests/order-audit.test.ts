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
  assert.equal(audit?.eventName, "INSERT");
  assert.equal(audit?.status, "awaiting_payment");
  assert.equal(audit?.previousStatus, undefined);
  assert.equal(JSON.stringify(audit).includes("customerEmail"), false);
});

test("audit logs only status changes for MODIFY", () => {
  assert.equal(buildOrderAuditRecord(orderEvent("MODIFY", "paid", "paid")), null);
  const audit = buildOrderAuditRecord(orderEvent("MODIFY", "awaiting_payment", "paid"));
  assert.equal(audit?.previousStatus, "awaiting_payment");
  assert.equal(audit?.status, "paid");
});

test("audit logs REMOVE and ignores order items and audit records", () => {
  const removed = buildOrderAuditRecord(orderEvent("REMOVE", "paid"))!;
  assert.equal(removed.previousStatus, "paid");
  assert.deepEqual(parseOrderAuditMessage(JSON.stringify(removed)), removed);
  const orderItem = orderEvent("INSERT", undefined, "pending");
  orderItem.dynamodb!.Keys!.SK = { S: "ORDER_ITEM#product-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
  orderItem.dynamodb!.Keys!.PK = { S: "AUDIT_LOG_ORDER#order-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
});

test("publisher retries failed Stream records and skips non-status changes", async () => {
  const unchanged = orderEvent("MODIFY", "paid", "paid");
  unchanged.dynamodb!.SequenceNumber = "41";
  const changed = orderEvent("MODIFY", "paid", "refund_pending");
  const published: string[] = [];
  const response = await publishOrderAuditRecords({ Records: [unchanged, changed] }, async (audit) => {
    published.push(audit.sourceEventId);
    throw new Error("SQS unavailable");
  });
  assert.deepEqual(published, ["shard:42"]);
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
    writes.push(audit.eventName);
    if (audit.eventName === "MODIFY") throw new Error("DynamoDB unavailable");
  });
  assert.deepEqual(writes, ["INSERT", "MODIFY"]);
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
});
