import { AccountAccess } from "../../../../modules/customers/authorization/application/account-lifecycle.js";
import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";



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

  await new AccountAccess({ status: id => readAccountStatus(dynamo,id), permissions: async () => [] }).signIn(subject);

  return event;
}
