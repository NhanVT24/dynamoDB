import assert from "node:assert/strict";
import { test } from "node:test";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

Object.assign(process.env, {
  DYNAMODB_ENDPOINT: "http://127.0.0.1:1",
  SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME: "feedback-set",
  VNPAY_TMN_CODE: "TEST", VNPAY_HASH_SECRET: "test-only",
  VNPAY_RETURN_URL: "http://localhost/result", VNPAY_IPN_URL: "http://localhost/ipn"
});

const { rawDb } = await import("../dist/src/database/dynamodb/client.js");
const { sesClient } = await import("../dist/src/integrations/ses/client.js");
const { sendBulkSaleEmail } = await import("../dist/src/integrations/ses/bulk-mailer.js");

const rows = new Map();
const key = (value) => `${value.PK}/${value.SK}`;

rawDb.send = async (command) => {
  if (command.constructor.name === "TransactWriteItemsCommand") {
    for (const operation of command.input.TransactItems) {
      const value = unmarshall(operation.Put.Item);
      rows.set(key(value), value);
    }
    return {};
  }
  if (command.constructor.name === "GetItemCommand") {
    const current = rows.get(key(unmarshall(command.input.Key)));
    return { Item: current ? marshall(current) : undefined };
  }
  assert.equal(command.constructor.name, "UpdateItemCommand");
  const current = rows.get(key(unmarshall(command.input.Key)));
  assert.ok(current, "bulk mailer must update a record it created");
  const values = unmarshall(command.input.ExpressionAttributeValues);
  if (values[":status"]) {
    if (current.SK === "META") current.sendStatus = values[":status"];
    else current.status = values[":status"];
  }
  if (values[":notSent"]) current.status = values[":notSent"];
  if (values[":unknown"]) {
    if (current.SK === "META") current.sendStatus = values[":unknown"];
    else current.status = values[":unknown"];
  }
  if (values[":messageId"]) current.sesMessageId = values[":messageId"];
  if (values[":failureReason"]) current.failureReason = values[":failureReason"];
  return {};
};

test("bulk send preserves per-recipient SES results instead of failing the entire attempt", async () => {
  rows.clear();
  sesClient.send = async (command) => {
    assert.equal(command.constructor.name, "SendBulkEmailCommand");
    assert.equal(command.input.BulkEmailEntries.length, 2);
    return {
      BulkEmailEntryResults: [
        { Status: "SUCCESS", MessageId: "ses-recipient-a" },
        { Status: "INVALID_PARAMETER", Error: "Recipient is invalid" }
      ]
    };
  };

  const attempts = await sendBulkSaleEmail({
    senderEmail: "sender@example.com", subject: "Sale", html: "<p>Sale</p>",
    recipients: ["a@example.com", "b@example.com"]
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "partial_sent", JSON.stringify([...rows.values()]));
  const records = [...rows.values()].filter((row) => row.SK.startsWith("RECIPIENT#"));
  assert.deepEqual(records.map((record) => record.status), ["accepted", "not_sent"]);
  assert.equal(records[0].sesMessageId, "ses-recipient-a");
});

test("a bulk API exception marks every unresolved recipient unknown, never pending", async () => {
  rows.clear();
  sesClient.send = async () => { throw new Error("AccessDenied: ses:SendBulkEmail"); };

  const attempts = await sendBulkSaleEmail({
    senderEmail: "sender@example.com", subject: "Sale", html: "<p>Sale</p>",
    recipients: ["a@example.com", "b@example.com"]
  });

  assert.equal(attempts[0].status, "unknown");
  const records = [...rows.values()].filter((row) => row.SK.startsWith("RECIPIENT#"));
  assert.deepEqual(records.map((record) => record.status), ["unknown", "unknown"]);
  assert.match(records[0].failureReason, /AccessDenied/);
});
