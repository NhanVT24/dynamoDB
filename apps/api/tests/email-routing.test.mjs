import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

Object.assign(process.env, {
  DYNAMODB_ENDPOINT: "http://127.0.0.1:1",
  VNPAY_TMN_CODE: "TEST",
  VNPAY_HASH_SECRET: "test-only",
  VNPAY_RETURN_URL: "http://localhost/result",
  VNPAY_IPN_URL: "http://localhost/ipn"
});

const { rawDb } = await import("../dist/src/database/dynamodb/client.js");
const routing = await import("../dist/src/modules/email-deliveries/email-route.repository.js");
const routeTracker = await import("../dist/src/entrypoints/lambda/jobs/email-route-tracker.js");

const rows = new Map();
const rowKey = (value) => `${value.PK}/${value.SK}`;
const conditionalFailure = () => Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });

beforeEach(() => rows.clear());

rawDb.send = async (command) => {
  const input = command.input;

  if (command.constructor.name === "PutItemCommand") {
    const value = unmarshall(input.Item);
    if (rows.has(rowKey(value))) throw conditionalFailure();
    rows.set(rowKey(value), value);
    return {};
  }

  if (command.constructor.name === "QueryCommand") {
    const values = unmarshall(input.ExpressionAttributeValues);
    const items = [...rows.values()].filter((value) =>
      value.entityType === values[":entityType"]
      && value.updatedAt <= values[":updatedBefore"]
      && value.status === values[":published"]
    );
    return { Items: items.map((value) => marshall(value)), ScannedCount: rows.size };
  }

  assert.equal(command.constructor.name, "UpdateItemCommand");
  const key = rowKey(unmarshall(input.Key));
  const current = rows.get(key);
  if (!current) throw conditionalFailure();
  const values = unmarshall(input.ExpressionAttributeValues);

  if (input.UpdateExpression.startsWith("SET eventId")) {
    current.eventId = values[":eventId"];
    current.publishedAt ??= values[":publishedAt"];
    return {};
  }

  if (input.ConditionExpression?.includes("routeStage < :nextStage")) {
    if (current.routeStage >= values[":nextStage"]) throw conditionalFailure();
    current.status = values[":status"];
    current.routeStage = values[":nextStage"];
    const timestampField = input.ExpressionAttributeNames["#timestamp"];
    current[timestampField] ??= values[":timestamp"];
    current.updatedAt = values[":timestamp"];
    delete current.alertStatus;
    delete current.publishFailureReason;
    return {};
  }

  if (input.ConditionExpression?.includes("routeStage = :publishingStage")) {
    if (current.routeStage !== values[":publishingStage"]) throw conditionalFailure();
    current.status = values[":status"];
    current.publishFailureReason = values[":reason"];
    current.updatedAt = values[":now"];
    return {};
  }

  if (input.ConditionExpression?.includes("routeStage = :publishedStage")) {
    if (current.status !== values[":published"] || current.routeStage !== values[":publishedStage"]) throw conditionalFailure();
    current.status = values[":suspected"];
    current.routingSuspectedAt = values[":now"];
    current.alertStatus = values[":pending"];
    current.updatedAt = values[":now"];
    return {};
  }

  if (input.UpdateExpression.includes("alertMessageId")) {
    current.alertStatus = values[":alertStatus"];
    current.alertMessageId = values[":messageId"];
    current.updatedAt = values[":now"];
    return {};
  }

  throw new Error(`Unhandled test update: ${input.UpdateExpression}`);
};

async function create(job = "a".repeat(64)) {
  return routing.ensureEmailRoute({ emailJobId: job, campaignId: "campaign-1", batchIndex: 0, batchCount: 1 });
}

test("late API acknowledgement cannot move RULE_MATCHED back to PUBLISHED", async () => {
  const emailJobId = "a".repeat(64);
  assert.equal(await create(emailJobId), true);
  assert.equal(await routing.markEmailRouteRuleMatched(emailJobId, "2026-09-15T07:00:02.000Z"), true);
  assert.equal(await routing.markEmailRoutePublished({ emailJobId, eventId: "event-1", publishedAt: "2026-09-15T07:00:01.000Z" }), false);

  const record = rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`);
  assert.equal(record.status, "RULE_MATCHED");
  assert.equal(record.routeStage, 30);
  assert.equal(record.eventId, "event-1");
  assert.equal(record.publishedAt, "2026-09-15T07:00:01.000Z");
});

test("duplicate and out-of-order acknowledgements never regress PROCESSING", async () => {
  const emailJobId = "b".repeat(64);
  await create(emailJobId);
  await routing.markEmailRoutePublished({ emailJobId, eventId: "event-2", publishedAt: "2026-09-15T07:00:01.000Z" });
  assert.equal(await routing.markEmailRouteProcessing(emailJobId, "2026-09-15T07:00:03.000Z"), true);
  assert.equal(await routing.markEmailRouteRuleMatched(emailJobId, "2026-09-15T07:00:04.000Z"), false);
  assert.equal(await routing.markEmailRouteProcessing(emailJobId, "2026-09-15T07:00:05.000Z"), false);

  const record = rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`);
  assert.equal(record.status, "PROCESSING");
  assert.equal(record.routeStage, 40);
});

test("watchdog claims only stale PUBLISHED routes and a later replay can recover them", async () => {
  const staleJobId = "c".repeat(64);
  const matchedJobId = "d".repeat(64);
  await create(staleJobId);
  await create(matchedJobId);
  await routing.markEmailRoutePublished({ emailJobId: staleJobId, eventId: "event-stale", publishedAt: "2026-09-15T07:00:00.000Z" });
  await routing.markEmailRoutePublished({ emailJobId: matchedJobId, eventId: "event-matched", publishedAt: "2026-09-15T07:00:00.000Z" });
  await routing.markEmailRouteRuleMatched(matchedJobId, "2026-09-15T07:00:01.000Z");

  const stale = await routing.findStalePublishedEmailRoutes("2026-09-15T07:05:00.000Z");
  assert.deepEqual(stale.map((route) => route.emailJobId), [staleJobId]);
  assert.equal(await routing.markEmailRouteRoutingSuspected(staleJobId), true);
  assert.equal(await routing.markEmailRouteRoutingSuspected(staleJobId), false);

  // Archive Replay reaches the repaired rule and advances the same record.
  assert.equal(await routing.markEmailRouteRuleMatched(staleJobId, "2026-09-15T07:06:00.000Z"), true);
  const record = rows.get(`EMAIL_ROUTE#${staleJobId}/STATUS`);
  assert.equal(record.status, "RULE_MATCHED");
  assert.equal(record.routeStage, 30);
});

test("reusing an idempotent emailJobId never resets its tracking record", async () => {
  const emailJobId = "e".repeat(64);
  assert.equal(await create(emailJobId), true);
  await routing.markEmailRouteProcessing(emailJobId);
  assert.equal(await create(emailJobId), false);
  assert.equal(rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`).status, "PROCESSING");
});

test("isolated failure and replay events are acknowledged by the real Rule tracker", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (const [marker, detailType] of [
      ["f", "email.eventbridge.delivery-failure.test"],
      ["g", "email.eventbridge.delivery-success.test"]
    ]) {
      const emailJobId = marker.repeat(64);
      await create(emailJobId);
      await routing.markEmailRoutePublished({
        emailJobId,
        eventId: `event-test-route-${marker}`,
        publishedAt: "2026-09-15T07:00:00.000Z"
      });

      const response = await routeTracker.handler({
        id: `event-test-route-${marker}`,
        source: "supermarket.email.test",
        "detail-type": detailType,
        detail: {
          testId: `isolated-test-${marker}`,
          emailJobId,
          campaignId: "delivery-routing-test"
        }
      });
      assert.deepEqual(response, { tracked: true });

      const record = rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`);
      assert.equal(record.status, "RULE_MATCHED");
      assert.equal(record.routeStage, 30);
    }
  } finally {
    console.log = originalLog;
  }
});
