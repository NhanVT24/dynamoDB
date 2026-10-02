import assert from "node:assert/strict";
import { test } from "node:test";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { UpdateItemCommandInput, PutItemCommandInput } from "@aws-sdk/client-dynamodb";
import { buildAuditLogRecord, parseAuditLogMessage, type AuditStreamRecord, type DynamoAttribute } from "../src/modules/audit-log/audit-log.js";
import { auditContext, type AuditWriteContext } from "../src/modules/audit-log/audit-context.js";
import { stampAuditWrite } from "../src/modules/audit-log/audit-write.js";
import { deletionAuditPut, deleteAuditedItem } from "../src/modules/audit-log/audit-delete.js";
import { processAuditLogMessages } from "../src/entrypoints/lambda/queue/audit-log-worker.js";

const actor: AuditWriteContext = { auditActorType: "ADMIN", auditActorId: "admin-1", auditActorRole: "admin",
  auditSource: "PATCH /api/shopping-items/:id", auditReason: "authenticated_mutation", auditRequestId: "request-1" };
const image = (value: Record<string, unknown>) => marshall(value) as Record<string, DynamoAttribute>;
function event(pk: string, sk: string, before?: Record<string, unknown>, after?: Record<string, unknown>): AuditStreamRecord {
  return { eventID: "stream-1", eventName: before ? after ? "MODIFY" : "REMOVE" : "INSERT", dynamodb: {
    Keys: image({ PK: pk, SK: sk }), OldImage: before ? image(before) : undefined, NewImage: after ? image(after) : undefined,
    SequenceNumber: "1", ApproximateCreationDateTime: 1790906400
  } };
}

for (const [pk, sk, field, type] of [
  ["PRODUCT#p1", "DETAIL", "price", "PRODUCT"], ["SALE_CAMPAIGN#s1", "DETAIL", "discountPercent", "SALE_CAMPAIGN"],
  ["NOTIFICATION#n1", "DETAIL", "isRead", "NOTIFICATION"], ["CHECKOUT_GATE#c1", "DETAIL", "status", "CHECKOUT"],
  ["CHECKOUT_RESERVATION#c1", "PRODUCT#p1", "quantity", "CHECKOUT"], ["EMAIL#e1", "META", "sendStatus", "EMAIL"],
  ["EMAIL#e1", "RECIPIENT#r1", "status", "EMAIL"], ["EMAIL_ROUTE#j1", "STATUS", "manualRetryCount", "EMAIL_ROUTE"],
  ["OPERATION#o1", "DETAIL", "status", "OPERATION"]
] as const) {
  test(`captures ${type} ${sk} and strips confidential fields`, () => {
    const audit = buildAuditLogRecord(event(pk, sk, { [field]: "before" }, { [field]: "after", password: "secret", html: "private email", email: "private", ...actor }));
    assert.equal(audit?.resourceType, type);
    assert.deepEqual(audit?.changes, { [field]: { before: "before", after: "after" } });
    assert.equal(audit?.actor.id, actor.auditActorId);
    assert.deepEqual(parseAuditLogMessage(JSON.stringify(audit)), audit);
  });
}

test("all editable product fields are auditable", async () => {
  const { createShoppingItemSchema } = await import("../src/modules/shopping/shopping.schema.js");
  const { auditFieldWhitelist } = await import("../src/modules/audit-log/audit-resources.js");
  for (const field of Object.keys(createShoppingItemSchema.shape)) {
    assert.ok((auditFieldWhitelist.PRODUCT as readonly string[]).includes(field), `missing ${field}`);
  }
});
test("metadata-only writes and index records do not produce audits", () => {
  assert.equal(buildAuditLogRecord(event("PRODUCT#p1", "DETAIL", { stock: 10 }, { stock: 10, ...actor })), null);
  assert.equal(buildAuditLogRecord(event("ORDER#o1", "ORDER_ITEM#p1", undefined, { status: "done" })), null);
});
test("DynamoDB number-to-string type changes remain distinguishable", () => {
  const audit = buildAuditLogRecord(event("PRODUCT#p1", "DETAIL", { stock: 10 }, { stock: "10" }));
  assert.deepEqual(audit?.changes.stock, { before: '"10"', after: "10" });
});
test("a grouped profile save produces a single event and ignores reordered permission sets", () => {
  const audit = buildAuditLogRecord(event("USER#u1", "PROFILE", { entityType: "USER_PROFILE", displayName: "Old", avatarKey: "old" }, { entityType: "USER_PROFILE", displayName: "New", avatarKey: "new" }));
  assert.equal(Object.keys(audit!.changes).length, 2);
  assert.equal(buildAuditLogRecord(event("USER#u1", "AUTHORIZATION", { entityType: "USER_AUTHORIZATION", permissions: new Set(["a", "b"]) }, { entityType: "USER_AUTHORIZATION", permissions: new Set(["b", "a"]) })), null);
});
test("payments without an order still have an audit", () => {
  const audit = buildAuditLogRecord(event("PAYMENT#txn1", "DETAIL", undefined, { entityType: "PAYMENT_SESSION", txnRef: "txn1", status: "pending" }));
  assert.equal(audit?.resourceType, "PAYMENT");
  assert.equal(audit?.parentResourceId, undefined);
});
test("raw deletes cannot inherit the last editor's identity", () => {
  const audit = buildAuditLogRecord(event("PRODUCT#p1", "DETAIL", { stock: 10, ...actor }));
  assert.equal(audit?.actor.id, "unknown");
});
test("outbox captures the deleting actor and suppresses raw REMOVE duplicates", () => {
  const snapshot = marshall({ PK: "PRODUCT#p1", SK: "DETAIL", stock: 10, auditDeleteOutbox: true });
  assert.equal(buildAuditLogRecord(event("PRODUCT#p1", "DETAIL", unmarshall(snapshot))), null);
  const put = auditContext.run(actor, () => deletionAuditPut("source", snapshot)).Put!;
  const audit = buildAuditLogRecord(event(put.Item!.PK!.S!, "DETAIL", undefined, unmarshall(put.Item!)));
  assert.equal(audit?.action, "DELETED");
  assert.equal(audit?.actor.id, actor.auditActorId);
  assert.deepEqual(audit?.changes.stock, { before: '"10"', after: null });
});
test("outbox expiration and operation expiration never create business delete events", () => {
  assert.equal(buildAuditLogRecord(event("AUDIT_EVENT#id", "DETAIL", { auditRecord: "not parsed on expiry" })), null);
  assert.equal(buildAuditLogRecord(event("OPERATION#id", "DETAIL", { status: "completed" })), null);
});
test("stamp respects table boundaries and existing SET/REMOVE/ADD clauses", () => {
  const update: UpdateItemCommandInput = { TableName: "source", Key: marshall({ PK: "PRODUCT#p1", SK: "DETAIL" }),
    UpdateExpression: "SET #stock = :stock REMOVE inventoryAlertSentAt ADD #version :one",
    ExpressionAttributeNames: { "#stock": "stock", "#version": "version" }, ExpressionAttributeValues: marshall({ ":stock": 10, ":one": 1 }) };
  auditContext.run(actor, () => stampAuditWrite("UpdateItemCommand", update, "source"));
  assert.match(update.UpdateExpression!, /REMOVE inventoryAlertSentAt ADD #version :one$/);
  assert.equal(update.ExpressionAttributeValues?.[":_audit_auditActorId"]?.S, actor.auditActorId);
  const foreign = { ...update, TableName: "audit" };
  const original = JSON.stringify(foreign);
  stampAuditWrite("UpdateItemCommand", foreign, "source");
  assert.equal(JSON.stringify(foreign), original);
});
test("authenticated caller replaces legacy service attribution without duplicate SET paths", () => {
  const update: UpdateItemCommandInput = { TableName: "source", Key: marshall({ PK: "ORDER#o1", SK: "ORDER" }),
    UpdateExpression: "SET #actor = :actor, auditSource = :source, #status = :status",
    ExpressionAttributeNames: { "#actor": "auditActorId", "#status": "status" }, ExpressionAttributeValues: marshall({ ":actor": "service:refund", ":source": "REFUND_API", ":status": "refund_pending" }) };
  auditContext.run(actor, () => stampAuditWrite("UpdateItemCommand", update, "source"));
  assert.equal(update.ExpressionAttributeValues?.[":actor"]?.S, actor.auditActorId);
  assert.equal(update.ExpressionAttributeValues?.[":source"]?.S, actor.auditSource);
  assert.equal(update.ExpressionAttributeValues?.[":status"]?.S, "refund_pending");
  assert.equal(update.ExpressionAttributeNames?.["#_audit_auditActorId"], undefined);
});
test("concurrent async requests keep distinct actors on transactional writes", async () => {
  const ids = await Promise.all(["user-1", "user-2"].map((id) => auditContext.run({ ...actor, auditActorId: id }, async () => {
    await new Promise((resolve) => setTimeout(resolve, id === "user-1" ? 5 : 1));
    const put: PutItemCommandInput = { TableName: "source", Item: marshall({ PK: "PRODUCT#p1", SK: "DETAIL", stock: 1 }) };
    stampAuditWrite("TransactWriteItemsCommand", { TransactItems: [{ Put: put }] }, "source");
    return put.Item?.auditActorId?.S;
  })));
  assert.deepEqual(ids, ["user-1", "user-2"]);
});
test("FIFO retry stops after the first failed write and duplicate delivery is accepted", async () => {
  const message = JSON.stringify(event("PRODUCT#p1", "DETAIL", undefined, { stock: 1 }));
  let calls = 0;
  const failed = await processAuditLogMessages({ Records: [{ messageId: "1", body: message }, { messageId: "2", body: message }] }, async () => { calls++; throw new Error("DynamoDB unavailable"); });
  assert.equal(calls, 1);
  assert.deepEqual(failed.batchItemFailures, [{ itemIdentifier: "1" }, { itemIdentifier: "2" }]);
  const duplicate = await processAuditLogMessages({ Records: [{ messageId: "1", body: message }] }, async () => { throw Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" }); });
  assert.deepEqual(duplicate.batchItemFailures, []);
});

test("password reset audits only its completion timestamp without replacing profile data", async () => {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { TriggerPostConfirmation } = await import("../src/entrypoints/lambda/cognito/triggers/post-confirmation.js");
  const db = new DynamoDBClient({ region: "ap-southeast-1" });
  let input: UpdateItemCommandInput | undefined;
  db.send = (async (command: { input: UpdateItemCommandInput }) => { input = command.input; return {}; }) as typeof db.send;
  await TriggerPostConfirmation(db, { triggerSource: "PostConfirmation_ConfirmForgotPassword", userPoolId: "pool", userName: "user",
    request: { userAttributes: { sub: "u1" }, code: "do-not-store", clientMetadata: { password: "do-not-store" } }, response: {} });
  assert.ok(input?.UpdateExpression?.includes("passwordResetAt"));
  assert.ok(!input?.UpdateExpression?.includes("displayName"));
  assert.ok(!JSON.stringify(input).includes("do-not-store"));
  assert.equal(input?.ExpressionAttributeValues?.[":actor"]?.S, "u1");
  db.destroy();
});

test("product delete audit and delete share a transaction guarded against a concurrent edit", async () => {
  const { rawDb } = await import("../src/database/dynamodb/client.js");
  const { deleteShoppingItem } = await import("../src/modules/shopping/shopping.repository.js");
  const { GetItemCommand, UpdateItemCommand, TransactWriteItemsCommand } = await import("@aws-sdk/client-dynamodb");
  const original = rawDb.send;
  let transactions = 0;
  let markers = 0;
  const snapshot = marshall({ PK: "PRODUCT#p1", SK: "DETAIL", id: "p1", stock: 10, category: "Dien tu", version: 3, updatedAt: "2026-10-02T00:00:00.000Z", ownerSub: "u1" });
  rawDb.send = (async (command: unknown) => {
    if (command instanceof GetItemCommand) return { Item: snapshot };
    if (command instanceof UpdateItemCommand) {
      markers++;
      assert.match(command.input.ConditionExpression!, /#version = :deleteVersion/);
      assert.equal(command.input.ExpressionAttributeValues?.[":deleteVersion"]?.N, "3");
      return {};
    }
    if (command instanceof TransactWriteItemsCommand) {
      transactions++;
      const items = command.input.TransactItems!;
      assert.equal(items.length, 3);
      assert.ok(items[0]?.Put?.Item?.auditRecord);
      assert.match(items[1]?.Delete?.ConditionExpression ?? "", /#version = :deleteVersion/);
      // Simulate the version changing between the snapshot read and commit.
      throw Object.assign(new Error("concurrent edit"), { name: "TransactionCanceledException" });
    }
    throw new Error("Unexpected command");
  }) as typeof rawDb.send;
  try {
    await assert.rejects(auditContext.run(actor, () => deleteShoppingItem("p1", "u1")), { name: "TransactionCanceledException" });
    assert.equal(markers, 1);
    assert.equal(transactions, 1);
  } finally { rawDb.send = original; }
});

test("notification cleanup skips stale candidates and protects same-millisecond read changes", async () => {
  const { rawDb } = await import("../src/database/dynamodb/client.js");
  const { GetItemCommand, UpdateItemCommand, TransactWriteItemsCommand } = await import("@aws-sdk/client-dynamodb");
  const original = rawDb.send;
  const key = marshall({ PK: "NOTIFICATION#n1", SK: "DETAIL" });
  const snapshot = marshall({ ...unmarshall(key), status: "sent", isRead: true, channel: "system", updatedAt: "2026-10-02T00:00:00.000Z" });
  let writes = 0;
  rawDb.send = (async (command: unknown) => {
    if (command instanceof GetItemCommand) return { Item: snapshot };
    if (command instanceof UpdateItemCommand) { writes++; return {}; }
    if (command instanceof TransactWriteItemsCommand) {
      writes++;
      const deletion = command.input.TransactItems![0]!.Delete!;
      const readAlias = Object.entries(deletion.ExpressionAttributeNames!).find(([, field]) => field === "isRead")![0];
      assert.ok(deletion.ConditionExpression!.includes(`${readAlias} =`));
      assert.ok(command.input.TransactItems![1]!.Put!.Item!.auditRecord);
      throw Object.assign(new Error("read flag changed"), { name: "TransactionCanceledException" });
    }
    throw new Error("Unexpected command");
  }) as typeof rawDb.send;
  try {
    assert.equal(await deleteAuditedItem("source", key, "older-timestamp"), false);
    assert.equal(writes, 0);
    await assert.rejects(deleteAuditedItem("source", key), { name: "TransactionCanceledException" });
    assert.equal(writes, 2);
  } finally { rawDb.send = original; }
});

test("HTTP interceptor establishes actor context and blocks external operations when the initial ledger fails", async () => {
  const { rawDb } = await import("../src/database/dynamodb/client.js");
  const { env } = await import("../src/config/env.js");
  const { AuditMutationInterceptor } = await import("../src/modules/audit-log/audit-mutation.interceptor.js");
  const { lastValueFrom, defer } = await import("rxjs");
  const originalSend = rawDb.send;
  const originalAuthFlag = env.AUTH_ALLOW_UNVERIFIED_JWT;
  env.AUTH_ALLOW_UNVERIFIED_JWT = true;
  const payload = Buffer.from(JSON.stringify({ sub: "admin-1", email: "admin@example.test", role: "admin" })).toString("base64url");
  function context(route: string) {
    return { switchToHttp: () => ({ getRequest: () => ({ method: "POST", routeOptions: { url: route }, url: route,
      headers: { authorization: `Bearer header.${payload}.signature` }, params: {} }) }) } as unknown as import("@nestjs/common").ExecutionContext;
  }
  try {
    const interceptor = new AuditMutationInterceptor();
    const result = await lastValueFrom(await interceptor.intercept(context("/api/shopping-items"), {
      handle: () => defer(async () => { await Promise.resolve(); return auditContext.getStore()?.auditActorId; })
    }));
    assert.equal(result, "admin-1");
    assert.equal(auditContext.getStore(), undefined);
    let handlerCalls = 0;
    rawDb.send = (async () => { throw new Error("ledger unavailable"); }) as typeof rawDb.send;
    await assert.rejects(lastValueFrom(await interceptor.intercept(context("/api/admin/ops/dlq/replay"), {
      handle: () => { handlerCalls++; return defer(async () => "replayed"); }
    })), /ledger unavailable/);
    assert.equal(handlerCalls, 0);
  } finally { rawDb.send = originalSend; env.AUTH_ALLOW_UNVERIFIED_JWT = originalAuthFlag; }
});

test("new resource filters paginate without skipping records and reject mismatched cursor partitions", async () => {
  const { rawDb } = await import("../src/database/dynamodb/client.js");
  const { listAuditLogs } = await import("../src/modules/audit-log/audit-log.repository.js");
  const { QueryCommand } = await import("@aws-sdk/client-dynamodb");
  const original = rawDb.send;
  const first = buildAuditLogRecord(event("PRODUCT#p1", "DETAIL", undefined, { stock: 10 }))!;
  const second = buildAuditLogRecord(event("PRODUCT#p2", "DETAIL", undefined, { stock: 20 }))!;
  rawDb.send = (async (command: unknown) => {
    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.ExpressionAttributeValues?.[":resourceType"]?.S, "PRODUCT");
    return { Items: (command.input.ExclusiveStartKey ? [second] : [first, second]).map((item) => marshall(item, { removeUndefinedValues: true })) };
  }) as typeof rawDb.send;
  try {
    const page = await listAuditLogs({ resourceType: "PRODUCT", limit: 1 });
    assert.equal(page.items[0]?.resourceId, "p1");
    assert.ok(page.nextCursor);
    const next = await listAuditLogs({ resourceType: "PRODUCT", limit: 1, cursor: page.nextCursor });
    assert.equal(next.items[0]?.resourceId, "p2");
    assert.equal(next.nextCursor, null);
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString("utf8"));
    cursor.keys.PRODUCT.resourceType = "USER";
    await assert.rejects(listAuditLogs({ resourceType: "PRODUCT", cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url") }), /Invalid audit pagination cursor/);
  } finally { rawDb.send = original; }
});
