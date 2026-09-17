import { UpdateItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent, CognitoUserSnapshot } from "../types.js";
import { getAttribute, normalizeEmail, resolveAuthProvider } from "./attributes.js";

export async function syncUserProfile(
  dynamo: DynamoDBClient,
  event: Pick<CognitoTriggerEvent, "userName">,
  user: CognitoUserSnapshot
) {
  const attributes = user.UserAttributes ?? [];
  const subject = getAttribute(attributes, "sub");
  if (!subject) {
    throw new Error("Cannot persist a Cognito user without a sub attribute.");
  }

  const email = normalizeEmail(getAttribute(attributes, "email"));
  const displayName = getAttribute(attributes, "name") || email || "Cognito User";
  const now = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME,
      Key: {
        PK: { S: `USER#${subject}` },
        SK: { S: "PROFILE" }
      },
      UpdateExpression: "SET #entityType = :entityType, #subject = :subject, #email = :email, #emailVerified = :emailVerified, #displayName = :displayName, #authProvider = :authProvider, #cognitoUsername = :cognitoUsername, #status = :status, #createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now",
      ConditionExpression: "attribute_not_exists(PK) OR #entityType <> :entityType OR #email <> :email OR #emailVerified <> :emailVerified OR #displayName <> :displayName OR #authProvider <> :authProvider OR #cognitoUsername <> :cognitoUsername OR #status <> :status",
      ExpressionAttributeNames: {
        "#entityType": "entityType",
        "#subject": "subject",
        "#email": "email",
        "#emailVerified": "emailVerified",
        "#displayName": "displayName",
        "#authProvider": "authProvider",
        "#cognitoUsername": "cognitoUsername",
        "#status": "status",
        "#createdAt": "createdAt",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":entityType": { S: "USER_PROFILE" },
        ":subject": { S: subject },
        ":email": { S: email },
        ":emailVerified": { BOOL: getAttribute(attributes, "email_verified") === "true" },
        ":displayName": { S: displayName },
        ":authProvider": { S: resolveAuthProvider(attributes) },
        ":cognitoUsername": { S: String(user.Username || event.userName || subject) },
        ":status": { S: String(user.UserStatus || "CONFIRMED") },
        ":now": { S: now }
      }
    }));
  } catch (error) {
    // Cognito can invoke token generation frequently. An unchanged profile is
    // an idempotent success and must not turn token issuance into a failure.
    if ((error as { name?: string } | undefined)?.name !== "ConditionalCheckFailedException") throw error;
  }
}
