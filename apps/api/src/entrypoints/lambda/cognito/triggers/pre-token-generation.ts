import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  type CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";
import { getAttribute, normalizeEmail, resolveAuthProvider } from "../helper/attributes.js";

const blockedStatuses = new Set(["SUSPENDED", "DISABLED", "BLOCKED"]);

async function readAuthorization(dynamo: DynamoDBClient, subject: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: process.env.DYNAMODB_TABLE_NAME,
    Key: {
      PK: { S: `USER#${subject}` },
      SK: { S: "AUTHORIZATION" }
    },
    ConsistentRead: true,
    ProjectionExpression: "#permissions",
    ExpressionAttributeNames: {
      "#permissions": "permissions"
    }
  }));

  return result.Item?.permissions?.SS ?? [];
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

export async function TriggerPreTokenGeneration(
  cognito: CognitoIdentityProviderClient,
  dynamo: DynamoDBClient,
  event: CognitoTriggerEvent
) {
  const user = await cognito.send(new AdminGetUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groupsResponse = await cognito.send(new AdminListGroupsForUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groups = (groupsResponse.Groups ?? []).map((group) => String(group.GroupName || "").toLowerCase());
  const role = groups.includes("admin") ? "admin" : groups.includes("customer") ? "customer" : "customer";
  const email = normalizeEmail(getAttribute(user.UserAttributes, "email"));
  const displayName = getAttribute(user.UserAttributes, "name") || email || "Cognito User";
  const subject = getAttribute(user.UserAttributes, "sub");
  const authProvider = resolveAuthProvider(user.UserAttributes);
  const accountStatus = subject ? await readAccountStatus(dynamo, subject) : "ACTIVE";

  if (blockedStatuses.has(accountStatus)) {
    console.warn(JSON.stringify({
      flow: "cognito_pre_token_generation",
      stage: "token_blocked",
      subject,
      email,
      accountStatus
    }));
    throw new Error("This account is not allowed to receive new tokens. Please contact support.");
  }

  const permissions = subject ? await readAuthorization(dynamo, subject) : [];
  const identityClaims = {
    role,
    auth_provider: authProvider,
    principal_email: email,
    display_name: displayName,
    account_status: accountStatus
  };

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: identityClaims
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          ...identityClaims,
          permissions
        },
        scopesToAdd: ["supermarket-api/access"]
      },
      groupOverrideDetails: {
        groupsToOverride: groups.length > 0 ? groups : ["customer"]
      }
    }
  };

  return event;
}
