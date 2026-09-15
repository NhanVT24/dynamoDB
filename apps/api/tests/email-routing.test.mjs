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
const retryPolicy = await import("../dist/src/modules/email-deliveries/email-publish-retry.js");
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
    const items = [...rows.values()].filter((value) => {
      if (input.IndexName === "StatusTimelineIndex") {
        if (!input.FilterExpression) return value.status === values[":failed"];
        const dueField = input.FilterExpression.split(" ")[0];
        return value.status === values[":status"]
          && value.updatedAt <= values[":now"]
          && value[dueField] <= values[":now"];
      }
      return value.entityType === values[":entityType"]
        && value.updatedAt <= values[":updatedBefore"]
        && value.status === values[":published"];
    });
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

  if (input.UpdateExpression.includes("ADD publishAttempts")) {
    const due = (current.status === values[":retry"] && current.nextPublishAt <= values[":now"])
      || (current.status === values[":publishing"] && current.publishLeaseUntil <= values[":now"]);
    if (current.routeStage !== values[":publishingStage"]
      || current.publishAttempts !== values[":expectedAttempt"]
      || current.publishAttempts >= values[":maxAttempts"]
      || !due) throw conditionalFailure();
    current.status = values[":publishing"];
    current.publishLeaseUntil = values[":leaseUntil"];
    current.updatedAt = values[":now"];
    current.publishAttempts += values[":one"];
    delete current.nextPublishAt;
    return { Attributes: marshall(current) };
  }

  if (input.UpdateExpression.includes("nextPublishAt = :nextPublishAt")) {
    if (current.routeStage !== values[":publishingStage"]
      || current.status !== values[":publishing"]
      || current.publishAttempts !== values[":attempt"]) throw conditionalFailure();
    current.status = values[":status"];
    current.publishFailureReason = values[":reason"];
    current.nextPublishAt = values[":nextPublishAt"];
    current.updatedAt = values[":now"];
    delete current.publishLeaseUntil;
    return {};
  }

  if (values[":failed"] && input.UpdateExpression.includes("#status = :failed")) {
    if (current.routeStage !== values[":publishingStage"]
      || ![values[":publishing"], values[":retry"]].includes(current.status)
      || current.publishAttempts !== values[":attempt"]) throw conditionalFailure();
    current.status = values[":failed"];
    current.publishFailureReason = values[":reason"];
    current.alertStatus = values[":pending"];
    current.updatedAt = values[":now"];
    delete current.nextPublishAt;
    delete current.publishLeaseUntil;
    return {};
  }

  if (input.UpdateExpression.includes("lastManualRetryAt")) {
    if (current.routeStage !== values[":publishingStage"] || current.status !== values[":failed"]) throw conditionalFailure();
    current.status = values[":retry"];
    current.publishAttempts = values[":zero"];
    current.nextPublishAt = values[":now"];
    current.lastManualRetryAt = values[":now"];
    current.updatedAt = values[":now"];
    current.manualRetryCount = (current.manualRetryCount ?? 0) + values[":one"];
    delete current.publishLeaseUntil;
    delete current.alertStatus;
    delete current.alertMessageId;
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
  return routing.ensureEmailRoute({
    emailJobId: job,
    campaignId: "campaign-1",
    batchIndex: 0,
    batchCount: 1,
    event: {
      busName: "platform-bus",
      source: "supermarket.email",
      detailType: "email.sale_campaign.requested",
      detail: { emailJobId: job, campaignId: "campaign-1" }
    }
  });
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

test("publish recovery uses exponential backoff with a cap", () => {
  const base = Date.parse("2026-09-16T00:00:00.000Z");
  assert.equal(retryPolicy.nextEmailPublishRetryAt(1, base, () => 0), "2026-09-16T00:01:00.000Z");
  assert.equal(retryPolicy.nextEmailPublishRetryAt(2, base, () => 0), "2026-09-16T00:02:00.000Z");
  assert.equal(retryPolicy.nextEmailPublishRetryAt(5, base, () => 0), "2026-09-16T00:15:00.000Z");
});

test("a failed publish is leased and retried up to attempt five before becoming PUBLISH_FAILED", async () => {
  const emailJobId = "h".repeat(64);
  await create(emailJobId);
  let attempt = 1;
  let dueAt = "2099-01-01T00:00:00.000Z";
  assert.equal(await routing.markEmailRoutePublishRetry({
    emailJobId,
    attempt,
    reason: "temporary",
    nextPublishAt: dueAt
  }), true);
  assert.deepEqual(
    (await routing.findDueEmailRoutePublishes(dueAt)).map((route) => route.emailJobId),
    [emailJobId]
  );

  while (attempt < 5) {
    const claimed = await routing.claimEmailRoutePublish({
      emailJobId,
      expectedAttempt: attempt,
      maxAttempts: 5,
      now: dueAt,
      leaseUntil: "2099-01-01T00:02:00.000Z"
    });
    assert.ok(claimed);
    attempt += 1;
    assert.equal(claimed.publishAttempts, attempt);

    if (attempt < 5) {
      dueAt = `2099-01-01T00:0${attempt}:00.000Z`;
      assert.equal(await routing.markEmailRoutePublishRetry({
        emailJobId,
        attempt,
        reason: "still temporary",
        nextPublishAt: dueAt
      }), true);
    }
  }

  assert.equal(await routing.markEmailRoutePublishFailed({
    emailJobId,
    attempt: 5,
    reason: "attempts exhausted"
  }), true);
  const record = rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`);
  assert.equal(record.status, "PUBLISH_FAILED");
  assert.equal(record.publishAttempts, 5);
  assert.equal(record.routeStage, 10);
  assert.equal(record.alertStatus, "PENDING");
});

test("admin can schedule exactly one fresh bounded retry cycle for a failed publish", async () => {
  const emailJobId = "i".repeat(64);
  await create(emailJobId);
  assert.equal(await routing.markEmailRoutePublishFailed({
    emailJobId,
    attempt: 1,
    reason: "Event bus does not exist"
  }), true);

  const failed = await routing.listFailedEmailRoutePublishes(50);
  assert.deepEqual(failed.map((route) => route.emailJobId), [emailJobId]);

  const retryAt = "2026-09-16T09:30:00.000Z";
  assert.equal(await routing.retryFailedEmailRoutePublish(emailJobId, retryAt), true);
  assert.equal(await routing.retryFailedEmailRoutePublish(emailJobId, retryAt), false);

  const record = rows.get(`EMAIL_ROUTE#${emailJobId}/STATUS`);
  assert.equal(record.status, "PUBLISH_RETRY");
  assert.equal(record.publishAttempts, 0);
  assert.equal(record.nextPublishAt, retryAt);
  assert.equal(record.manualRetryCount, 1);
  assert.equal(record.lastManualRetryAt, retryAt);
  assert.equal(record.alertStatus, undefined);
});
