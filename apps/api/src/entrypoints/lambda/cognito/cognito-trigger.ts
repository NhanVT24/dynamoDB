import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "./types.js";
import { getAttribute, normalizeEmail, resolveAuthProvider } from "./helper/attributes.js";
import { TriggerPreAuthentication } from "./triggers/pre-authentication.js";
import { TriggerPostAuthentication } from "./triggers/post-authentications.js";
import { TriggerPostConfirmation } from "./triggers/post-confirmation.js";

const client = new CognitoIdentityProviderClient({});
const dynamo = new DynamoDBClient({});

async function handleTokenGeneration(event: CognitoTriggerEvent) {
  const user = await client.send(new AdminGetUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groupsResponse = await client.send(new AdminListGroupsForUserCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName
  }));

  const groups = (groupsResponse.Groups ?? []).map((group) => String(group.GroupName || "").toLowerCase());
  const role = groups.includes("admin") ? "admin" : groups.includes("customer") ? "customer" : "customer";
  const email = normalizeEmail(getAttribute(user.UserAttributes, "email"));
  const displayName = getAttribute(user.UserAttributes, "name") || email || "Cognito User";
  const subject = getAttribute(user.UserAttributes, "sub");

  const permissions = subject
    ? (await dynamo.send(new GetItemCommand({
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
    }))).Item?.permissions?.SS ?? []
    : [];

  const authProvider = resolveAuthProvider(user.UserAttributes);

  const identityClaims = {
    role,
    auth_provider: authProvider,
    principal_email: email,
    display_name: displayName
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

export const handler = async (event: CognitoTriggerEvent) => {
  if (event.triggerSource === "PreAuthentication_Authentication") {
    return TriggerPreAuthentication(dynamo, event);
  }

  if (event.triggerSource === "PostConfirmation_ConfirmSignUp") {
    return TriggerPostConfirmation(dynamo, event);
  }

  if (event.triggerSource === "PostAuthentication_Authentication") {
    return TriggerPostAuthentication(dynamo, event);
  }

  if (String(event.triggerSource || "").startsWith("TokenGeneration_")) {
    return handleTokenGeneration(event);
  }

  return event;
};
