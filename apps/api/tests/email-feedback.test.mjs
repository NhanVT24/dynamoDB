import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

Object.assign(process.env, {
  VNPAY_TMN_CODE: "TEST", VNPAY_HASH_SECRET: "test-only",
  VNPAY_RETURN_URL: "http://localhost/result", VNPAY_IPN_URL: "http://localhost/ipn",
  DYNAMODB_ENDPOINT: "http://127.0.0.1:1", SES_EVENTS_TOPIC_ARN: "arn:aws:sns:ap-southeast-1:123456789012:feedback"
});
const { rawDb } = await import("../dist/src/database/dynamodb/client.js");
const { handler, processSesMessage } = await import("../dist/src/entrypoints/lambda/jobs/ses-inventory-event.js");
const { markEmailRecipientAccepted } = await import("../dist/src/modules/email-deliveries/email-delivery.repository.js");
let rows, writes, failWrite;
const key = (row) => `${row.PK}/${row.SK}`;
const row = (id, email) => ({ PK: "EMAIL#e1", SK: `RECIPIENT#${id}`, recipientId: id, recipientEmail: email, status: "pending" });
beforeEach(() => {
  rows = new Map([row("a", "a@example.com"), row("b", "b@example.com"), row("c", "c@example.com")].map((r) => [key(r), r]));
  writes = 0; failWrite = false;
});
rawDb.send = async (command) => {
  const input = command.input;
  if (command.constructor.name === "GetItemCommand") {
    const value = rows.get(key(unmarshall(input.Key)));
    return { Item: value ? marshall(value) : undefined };
  }
  if (command.constructor.name === "QueryCommand") return { Items: [...rows.values()].filter((r) => r.SK.startsWith("RECIPIENT#")).map((r) => marshall(r)) };
  assert.equal(command.constructor.name, "UpdateItemCommand");
  if (failWrite) throw new Error("Database unavailable");
  const values = unmarshall(input.ExpressionAttributeValues);
  const expression = input.ConditionExpression + " " + input.UpdateExpression;
  // DynamoDB rejects unused placeholders at runtime; tsc cannot catch this.
  const used = new Set(expression.match(/:[a-zA-Z0-9_]+/g));
  assert.deepEqual(new Set(Object.keys(values)), used);
  const current = rows.get(key(unmarshall(input.Key)));
  const allowed = Object.entries(values).filter(([k]) => k.startsWith(":from")).map(([, v]) => v);
  if (!current || !allowed.includes(current.status)) {
    throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
  }
  current.status = values[":status"];
  if (values[":messageId"]) current.sesMessageId = values[":messageId"];
  current.statusAt = values[":eventAt"];
  writes++;
  return {};
};

function event(type, addresses = ["a@example.com"], tags = { emailId: ["e1"], recipientId: ["a"] }) {
  const value = { eventType: type, mail: { messageId: "ses1", timestamp: "2026-09-09T01:00:00Z", tags, destination: ["a@example.com", "b@example.com", "c@example.com"] } };
  const detail = { timestamp: "2026-09-09T01:05:00Z" };
  if (type === "Delivery") value.delivery = { ...detail, recipients: addresses };
  if (type === "Bounce") value.bounce = { ...detail, bounceType: "Permanent", bouncedRecipients: addresses.map((emailAddress) => ({ emailAddress })) };
  if (type === "Complaint") value.complaint = { ...detail, complainedRecipients: addresses.map((emailAddress) => ({ emailAddress })) };
  if (type === "DeliveryDelay") value.deliveryDelay = { ...detail, delayedRecipients: addresses.map((emailAddress) => ({ emailAddress })) };
  if (type === "Reject") value.reject = { reason: "Bad content" };
  if (type === "Rendering Failure") value.failure = { errorMessage: "Invalid template" };
  return JSON.stringify(value);
}

for (const [type, expected] of [["Send", "accepted"], ["Delivery", "delivered"], ["Bounce", "bounced"], ["Complaint", "complained"], ["DeliveryDelay", "delivery_delayed"], ["Reject", "rejected"], ["Rendering Failure", "rejected"]]) {
  test(`${type} updates the addressed child; duplicate is a no-op`, async () => {
    await processSesMessage(event(type));
    await processSesMessage(event(type));
    assert.equal(rows.get("EMAIL#e1/RECIPIENT#a").status, expected);
    assert.equal(rows.get("EMAIL#e1/RECIPIENT#b").status, "pending");
    assert.equal(writes, 1);
  });
}
test("delivery before API response survives late acceptance/delay", async () => {
  await processSesMessage(event("Delivery"));
  await markEmailRecipientAccepted({ emailId: "e1", recipientId: "a" });
  await processSesMessage(event("DeliveryDelay"));
  assert.equal(rows.get("EMAIL#e1/RECIPIENT#a").status, "delivered");
  assert.equal(rows.get("EMAIL#e1/RECIPIENT#a").statusAt, "2026-09-09T01:05:00Z");
  assert.equal(writes, 1);
});
test("complaint survives late delivery and bounce", async () => {
  await processSesMessage(event("Complaint"));
  await processSesMessage(event("Delivery"));
  await processSesMessage(event("Bounce"));
  assert.equal(rows.get("EMAIL#e1/RECIPIENT#a").status, "complained");
  assert.equal(writes, 1);
});
test("shared To/CC/BCC message changes only addresses in the outcome", async () => {
  await processSesMessage(event("Delivery", ["a@example.com", "c@example.com"], { emailId: ["e1"] }));
  await processSesMessage(event("Bounce", ["b@example.com"], { emailId: ["e1"] }));
  assert.deepEqual([...rows.values()].map((r) => r.status), ["delivered", "bounced", "delivered"]);
});
test("legacy DETAIL receives in-flight event after schema change", async () => {
  rows.clear();
  rows.set("EMAIL#e1/DETAIL", { PK: "EMAIL#e1", SK: "DETAIL", recipientEmail: "a@example.com", status: "accepted" });
  await processSesMessage(event("Delivery", undefined, { emailId: ["e1"] }));
  assert.equal(rows.get("EMAIL#e1/DETAIL").status, "delivered");
});
test("missing record and malformed event fail for retry, not silent loss", async () => {
  rows.clear();
  await assert.rejects(processSesMessage(event("Delivery")), /target not found/);
  await assert.rejects(processSesMessage("{}"));
});
test("an event for another recipient cannot change this child", async () => {
  await processSesMessage(event("Bounce", ["other@example.com"]));
  assert.equal(writes, 0);
});
test("database failure propagates through SNS handler for Lambda retry", async () => {
  failWrite = true;
  await assert.rejects(handler({ Records: [{ Sns: { TopicArn: process.env.SES_EVENTS_TOPIC_ARN, Message: event("Delivery") } }] }), /Failed to process/);
});
test("unexpected topic is rejected", async () => {
  await assert.rejects(handler({ Records: [{ Sns: { TopicArn: "wrong", Message: event("Delivery") } }] }));
  assert.equal(writes, 0);
});
