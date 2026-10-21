import { AccountAccess } from "../../../../modules/customers/authorization/application/account-lifecycle.js";
import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  type CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { CognitoTriggerEvent } from "../types.js";
import { getAttribute, normalizeEmail, resolveAuthProvider } from "../helper/attributes.js";



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
  const email = normalizeEmail(getAttribute(user.UserAttributes, "email"));
  const displayName = getAttribute(user.UserAttributes, "name") || email || "Cognito User";
  const subject = getAttribute(user.UserAttributes, "sub");
  const authProvider = resolveAuthProvider(user.UserAttributes);
  const claims = await new AccountAccess({status:id=>readAccountStatus(dynamo,id),permissions:id=>readAuthorization(dynamo,id)})
    .claims({subject,groups,email,displayName,provider:authProvider});
  const identityClaims=claims.identity, permissions=claims.permissions;

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
        groupsToOverride: claims.groups
      }
    }
  };

  return event;
}
