import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrderAuditRecord, type OrderStreamRecord } from "../src/modules/storefront/order-audit.ts";

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
  assert.equal(buildOrderAuditRecord(orderEvent("REMOVE", "paid"))?.previousStatus, "paid");
  const orderItem = orderEvent("INSERT", undefined, "pending");
  orderItem.dynamodb!.Keys!.SK = { S: "ORDER_ITEM#product-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
  orderItem.dynamodb!.Keys!.PK = { S: "AUDIT_LOG_ORDER#order-1" };
  assert.equal(buildOrderAuditRecord(orderItem), null);
});
