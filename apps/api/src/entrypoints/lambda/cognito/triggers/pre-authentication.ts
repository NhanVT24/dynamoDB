import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";

const blockedStatuses = new Set(["SUSPENDED", "DISABLED", "BLOCKED"]);

function resolveSubject(event: CognitoTriggerEvent) {
  return String(event.request.userAttributes?.sub || "").trim();
}

async function readAccountStatus(dynamo: DynamoDBClient, subject: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME,
    Key: {
      PK: { S: `USER#${subject}` },
      SK: { S: "PROFILE" }
    },
    ConsistentRead: true,
    ProjectionExpression: "#status",
    ExpressionAttributeNames: {
      "#status": "status"
    }
  }));

  return String(result.Item?.status?.S || "ACTIVE").trim().toUpperCase();
}

export async function TriggerPreAuthentication(dynamo: DynamoDBClient, event: CognitoTriggerEvent) {
  if (event.triggerSource !== "PreAuthentication_Authentication") {
    return event;
  }

  const subject = resolveSubject(event);
  if (!subject) {
    return event;
  }

  const status = await readAccountStatus(dynamo, subject);
  if (blockedStatuses.has(status)) {
    const email = normalizeEmail(event.request.userAttributes?.email);
    console.warn(JSON.stringify({
      flow: "cognito_pre_authentication",
      stage: "login_blocked",
      subject,
      email,
      status
    }));
    throw new Error("This account is not allowed to sign in. Please contact support.");
  }

  return event;
}
