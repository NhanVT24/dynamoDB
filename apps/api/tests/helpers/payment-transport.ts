import assert from "node:assert/strict";
import type { DynamoDBClient, TransactWriteItemsCommandInput, UpdateItemCommandInput } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
const productId = "12345678-1234-4234-8234-123456789013";
export function transport(client: DynamoDBClient) {
  type Row = Record<string, any>;
  let rows = new Map<string, Row>();
  let beforeTransaction: (() => void) | undefined;
  let loseResponse = false;
  const writes: TransactWriteItemsCommandInput[] = [];
  const key = (row: Row) => `${row.PK}|${row.SK}`;
  const put = (row: Row) => rows.set(key(row), structuredClone(row));
  const get = (pk: string, sk = "ORDER") => rows.get(`${pk}|${sk}`);
  const conditional = () => Object.assign(new Error("conditional failed"), { name: "ConditionalCheckFailedException" });
  const applyUpdate = (input: UpdateItemCommandInput, target: Map<string, Row>) => {
    const k = key(unmarshall(input.Key!)), row = target.get(k) ?? (k.startsWith("RECOVERY_CURSOR#") ? unmarshall(input.Key!) : undefined);
    if (!row) throw conditional();
    const v = unmarshall(input.ExpressionAttributeValues ?? {}), c = input.ConditionExpression ?? "";
    if (c.includes("#version = :expectedVersion") && row.version !== v[":expectedVersion"]) throw conditional();
    if (c.includes("attribute_not_exists(#version)") && row.version !== undefined) throw conditional();
    if (c.includes("#status = :pendingStatus") && row.status !== "pending") throw conditional();
    if (c.includes("#status = :awaitingPayment") && row.status !== "awaiting_payment") throw conditional();
    if (c.includes("#status = :awaiting AND") && row.status !== "awaiting_payment") throw conditional();
    if (c.includes("customerEmail = :expectedCustomerEmail") && row.customerEmail !== v[":expectedCustomerEmail"]) throw conditional();
    if (c.includes("paymentTxnRef = :expectedTxnRef") && row.paymentTxnRef !== v[":expectedTxnRef"]) throw conditional();
    if (c.includes("totalAmount = :expectedAmount") && row.totalAmount !== v[":expectedAmount"]) throw conditional();
    if (c.includes("lockedUntil <= :expiresBefore") && row.lockedUntil > v[":expiresBefore"]) throw conditional();
    if (c.includes("attribute_not_exists(paymentEventEnqueuedAt)") && row.paymentEventEnqueuedAt) throw conditional();
    if (c.includes("attribute_not_exists(paymentTxnRef)") && row.paymentTxnRef &&
      !(c.includes("OR paymentTxnRef = :txnRef") && row.paymentTxnRef === v[":txnRef"])) throw conditional();
    if (c.includes("customerEmail = :email") && row.customerEmail !== v[":email"]) throw conditional();
    if (c.includes("totalAmount = :amount") && row.totalAmount !== v[":amount"]) throw conditional();
    if (c.includes("lockedUntil > :now") && row.lockedUntil <= v[":now"]) throw conditional();
    if (c.includes("attribute_not_exists(revision)") && row.revision !== undefined) throw conditional();
    if (c.includes("revision = :expected") && row.revision !== v[":expected"]) throw conditional();
    if (c.includes("attribute_not_exists(recoveryAttempts)") && row.recoveryAttempts !== undefined) throw conditional();
    if (c.includes("recoveryAttempts = :previous") && row.recoveryAttempts !== v[":previous"]) throw conditional();
    if (c.includes("#status = :pending AND") && row.status !== "pending") throw conditional();
    if (c.includes("#status = :open") && row.status !== v[":open"]) throw conditional();
    if (c.includes("#reason = :oldReason") && row.reason !== v[":oldReason"]) throw conditional();
    const next = { ...row };
    for (const match of (input.UpdateExpression ?? "").matchAll(/([#\w]+)\s*=\s*(:\w+)/g)) {
      next[input.ExpressionAttributeNames?.[match[1]] ?? match[1]] = v[match[2]];
    }
    const removed = input.UpdateExpression?.split(" REMOVE ")[1];
    if (removed) for (const field of removed.split(",")) delete next[input.ExpressionAttributeNames?.[field.trim()] ?? field.trim()];
    target.set(k, next);
    return next;
  };
  client.middlewareStack.add((_next, context) => async args => {
    const input = args.input as any;
    let output: Row & { $metadata: {} } = { $metadata: {} };
    if (context.commandName === "GetItemCommand") {
      assert.equal(input.ConsistentRead, true);
      const row = rows.get(key(unmarshall(input.Key)));
      output.Item = row && marshall(row, { removeUndefinedValues: true });
    } else if (context.commandName === "QueryCommand") {
      const v = unmarshall(input.ExpressionAttributeValues);
      if (input.IndexName) {
        const all = [...rows.values()].filter(row => input.IndexName === "EntityUpdatedAtIndex"
          ? row.entityType === (v[":entity"] ?? v[":entityType"]) : row.status === v[":status"]).sort((a, b) =>
          String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")) || key(a).localeCompare(key(b)));
        const start = input.ExclusiveStartKey && unmarshall(input.ExclusiveStartKey);
        const offset = start ? Math.max(0, all.findIndex(row => key(row) === key(start)) + 1) : 0;
        const evaluated = all.slice(offset, offset + (input.Limit ?? all.length));
        const selected = evaluated.filter(row => (!v[":status"] || row.status === v[":status"]) && (!v[":entityType"] || row.entityType === v[":entityType"]) && (!v[":entity"] || row.entityType === v[":entity"]) &&
          (!input.FilterExpression?.includes("attribute_not_exists(paymentTxnRef)") || !row.paymentTxnRef) &&
          (!input.FilterExpression?.includes("attribute_not_exists(paymentEventEnqueuedAt)") || !row.paymentEventEnqueuedAt));
        output.Items = selected.map(row => marshall(row, { removeUndefinedValues: true }));
        if (evaluated.length && offset + evaluated.length < all.length) {
          const last = evaluated.at(-1)!;
          output.LastEvaluatedKey = marshall({ PK: last.PK, SK: last.SK, updatedAt: last.updatedAt ?? "",
            ...(input.IndexName === "EntityUpdatedAtIndex" ? { entityType: last.entityType } : { status: last.status }) });
        }
      } else output.Items = [...rows.values()].filter(row => row.PK === v[":pk"] && row.SK.startsWith(v[":itemPrefix"]))
        .map(row => marshall(row, { removeUndefinedValues: true }));
    } else if (context.commandName === "ScanCommand") output.Items = [];
    else if (context.commandName === "PutItemCommand") {
      const row = unmarshall(input.Item);
      if (rows.has(key(row)) && input.ConditionExpression?.includes("attribute_not_exists(PK)")) throw conditional();
      put(row);
    } else if (context.commandName === "UpdateItemCommand") output.Attributes = marshall(applyUpdate(input, rows), { removeUndefinedValues: true });
    else if (context.commandName === "TransactWriteItemsCommand") {
      if (beforeTransaction) { const effect = beforeTransaction; beforeTransaction = undefined; effect(); }
      const next = structuredClone(rows), touched = new Set<string>();
      const tx = input as TransactWriteItemsCommandInput;
      writes.push(tx);
      for (const [index, op] of tx.TransactItems!.entries()) {
        const itemKey = key(unmarshall((op.Put?.Item ?? op.Update?.Key ?? op.Delete?.Key ?? op.ConditionCheck?.Key)!));
        assert.equal(touched.has(itemKey), false, "DynamoDB forbids duplicate item operations");
        touched.add(itemKey);
        try {
          if (op.Update) applyUpdate(op.Update, next);
          if (op.Put) {
            if (op.Put.ConditionExpression?.includes("attribute_not_exists(PK)") && next.has(itemKey)) throw conditional();
            next.set(itemKey, unmarshall(op.Put.Item!));
          }
          if (op.Delete) next.delete(itemKey);
          if (op.ConditionCheck && next.get(itemKey)?.status === "success") throw conditional();
        } catch (error) {
          if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
          throw Object.assign(new Error("transaction cancelled"), { name: "TransactionCanceledException",
            CancellationReasons: tx.TransactItems!.map((_, i) => ({ Code: i === index ? "ConditionalCheckFailed" : "None" })) });
        }
      }
      rows = next;
      if (loseResponse) { loseResponse = false; throw new Error("Transaction committed but response lost"); }
    } else throw new Error(`Unexpected ${context.commandName}`);
    return { response: {}, output };
  }, { step: "initialize", priority: "low", name: "phase4Transport" });
  put({ PK: `PRODUCT#${productId}`, SK: "DETAIL", id: productId, entityType: "PRODUCT", name: "Product", category: "Food",
    price: 1000, stock: 12, soldCount: 0, status: "active", version: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
  return { put, get, writes, rows: () => [...rows.values()], race(effect: () => void) { beforeTransaction = effect; },
    loseNextTransactionResponse() { loseResponse = true; },
    close() { client.middlewareStack.remove("phase4Transport"); } };
}
