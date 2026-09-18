import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand
} from "@aws-sdk/client-cognito-identity-provider";
import type { CognitoTriggerEvent, CognitoUserSnapshot } from "../types.js";
import { getAttribute, normalizeEmail, parseProviderUserName } from "./attributes.js";

const client = new CognitoIdentityProviderClient({});

type CognitoClient = Pick<CognitoIdentityProviderClient, "send">;

export async function findUsersByEmail(
  userPoolId: string,
  email: string,
  cognito: CognitoClient = client
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  const response = await cognito.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${normalizedEmail.replace(/"/g, '\\"')}"`,
    Limit: 10
  }));

  return (response.Users ?? []).filter((user) => String(user.Username || "").trim() !== "");
}

function isNativeCognitoUser(user: CognitoUserSnapshot | null | undefined) {
  return !getAttribute(user?.UserAttributes, "identities");
}

export async function assertEmailNotAlreadyRegistered(
  userPoolId: string,
  email: string,
  cognito: CognitoClient = client
) {
  const existingUsers = await findUsersByEmail(userPoolId, email, cognito);
  if (existingUsers.length > 0) {
    throw new Error("An account already exists for this email. Please sign in with the original provider.");
  }
}

export async function linkExternalProviderToNativeUser(
  event: CognitoTriggerEvent,
  email: string,
  cognito: CognitoClient = client
) {
  const { providerName, providerUserId } = parseProviderUserName(event.userName);
  if (!providerName || !providerUserId) return;

  const existingUsers = await findUsersByEmail(event.userPoolId, email, cognito);
  const existingUser = existingUsers.find((user) => {
    const username = String(user.Username || "");
    const snapshot = { Username: user.Username, UserStatus: user.UserStatus, UserAttributes: user.Attributes };
    return !username.startsWith(`${providerName}_`) && isNativeCognitoUser(snapshot);
  });
  const existingUsername = String(existingUser?.Username || "");

  if (!existingUser || !existingUsername) return;

  await cognito.send(new AdminLinkProviderForUserCommand({
    UserPoolId: event.userPoolId,
    DestinationUser: {
      ProviderName: "Cognito",
      ProviderAttributeValue: existingUsername
    },
    SourceUser: {
      ProviderName: providerName,
      ProviderAttributeName: "Cognito_Subject",
      ProviderAttributeValue: providerUserId
    }
  }));
}
