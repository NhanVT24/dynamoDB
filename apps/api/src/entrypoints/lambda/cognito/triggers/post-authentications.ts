import crypto from "node:crypto";
import { PutItemCommand, UpdateItemCommand, type AttributeValue, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";

function resolveSubject(event: CognitoTriggerEvent) {
  return String(event.request.userAttributes?.sub || "").trim();
}

function resolveRequestIp(event: CognitoTriggerEvent) {
  return String(event.request.userContextData?.ipAddress || event.request.validationData?.ipAddress || "").trim();
}

function resolveAccountStatus(attributes: Record<string, AttributeValue> | undefined) {
  return String(attributes?.status?.S || "ACTIVE").trim().toUpperCase();
}

async function recordSuccessfulLogin(dynamo: DynamoDBClient, event: CognitoTriggerEvent) {
  const subject = resolveSubject(event);
  if (!subject) return;

  const now = new Date().toISOString();
  const email = normalizeEmail(event.request.userAttributes?.email);
  const ipAddress = resolveRequestIp(event);
  const auditId = crypto.randomUUID();

  const profileUpdate = await dynamo.send(new UpdateItemCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME,
    Key: {
      PK: { S: `USER#${subject}` },
      SK: { S: "PROFILE" }
    },
    UpdateExpression: "SET #entityType = if_not_exists(#entityType, :entityType), #subject = if_not_exists(#subject, :subject), #email = if_not_exists(#email, :email), #lastLoginAt = :now, #lastLoginIp = :ipAddress, #updatedAt = :now ADD #loginCount :one",
    ExpressionAttributeNames: {
      "#entityType": "entityType",
      "#subject": "subject",
      "#email": "email",
      "#lastLoginAt": "lastLoginAt",
      "#lastLoginIp": "lastLoginIp",
      "#updatedAt": "updatedAt",
      "#loginCount": "loginCount"
    },
    ExpressionAttributeValues: {
      ":entityType": { S: "USER_PROFILE" },
      ":subject": { S: subject },
      ":email": { S: email },
      ":now": { S: now },
      ":ipAddress": { S: ipAddress },
      ":one": { N: "1" }
    },
    ReturnValues: "ALL_NEW"
  }));
  const accountStatus = resolveAccountStatus(profileUpdate.Attributes);

  await dynamo.send(new PutItemCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME,
    Item: {
      PK: { S: `USER#${subject}` },
      SK: { S: `AUDIT#LOGIN#${now}#${auditId}` },
      entityType: { S: "USER_LOGIN_AUDIT" },
      subject: { S: subject },
      email: { S: email },
      status: { S: "SUCCESS" },
      accountStatus: { S: accountStatus },
      ipAddress: { S: ipAddress },
      createdAt: { S: now }
    },
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }));
}

export async function TriggerPostAuthentication(dynamo: DynamoDBClient, event: CognitoTriggerEvent) {
  if (event.triggerSource !== "PostAuthentication_Authentication") {
    return event;
  }

  try {
    await recordSuccessfulLogin(dynamo, event);
  } catch (error) {
    console.error(JSON.stringify({
      flow: "cognito_post_authentication",
      stage: "login_audit_failed",
      subject: resolveSubject(event),
      message: error instanceof Error ? error.message : "unknown"
    }));
  }

  return event;
}
