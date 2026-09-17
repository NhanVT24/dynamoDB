import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminLinkProviderForUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { getAttribute, normalizeEmail, parseProviderUserName, resolveAuthProvider } from "./attributes.js";
import { syncUserProfile } from "./profile.js";

type CognitoTriggerEvent = {
  triggerSource?: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes?: Record<string, string>;
  };
  response: Record<string, unknown>;
};

const client = new CognitoIdentityProviderClient({});
const dynamo = new DynamoDBClient({});

async function findExistingUserByEmail(userPoolId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const response = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${normalizedEmail.replace(/"/g, '\\"')}"`,
    Limit: 10
  }));

  const users = response.Users ?? [];
  return users.find((user) => String(user.Username || "").toLowerCase() !== "") ?? null;
}

async function handlePreSignUp(event: CognitoTriggerEvent) {
  if (event.triggerSource !== "PreSignUp_ExternalProvider") {
    return event;
  }

  const email = normalizeEmail(event.request.userAttributes?.email);
  const { providerName, providerUserId } = parseProviderUserName(event.userName);

  if (!email || !providerName || !providerUserId) {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  const existingUser = await findExistingUserByEmail(event.userPoolId, email);

  if (existingUser && !String(existingUser.Username || "").startsWith(`${providerName}_`)) {
    await client.send(new AdminLinkProviderForUserCommand({
      UserPoolId: event.userPoolId,
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: existingUser.Username
      },
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: providerUserId
      }
    }));
  }

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}

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

  await syncUserProfile(dynamo, event, user);

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

async function handlePostConfirmation(event: CognitoTriggerEvent) {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  await client.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: "customer"
  }));

  await syncUserProfile(dynamo, event, {
    Username: event.userName,
    UserStatus: "CONFIRMED",
    UserAttributes: Object.entries(event.request.userAttributes ?? {}).map(([Name, Value]) => ({ Name, Value }) satisfies AttributeType)
  });

  return event;
}

export const handler = async (event: CognitoTriggerEvent) => {
  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    return handlePreSignUp(event);
  }

  if (event.triggerSource === "PostConfirmation_ConfirmSignUp") {
    return handlePostConfirmation(event);
  }

  if (String(event.triggerSource || "").startsWith("TokenGeneration_")) {
    return handleTokenGeneration(event);
  }

  return event;
};
