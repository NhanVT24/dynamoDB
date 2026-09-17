import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand
} from "@aws-sdk/client-cognito-identity-provider";
import type { CognitoTriggerEvent, CognitoUserSnapshot } from "../types.js";
import { getAttribute, normalizeEmail, parseProviderUserName } from "./attributes.js";

const client = new CognitoIdentityProviderClient({});

async function findExistingUserByEmail(userPoolId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const response = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${normalizedEmail.replace(/"/g, '\\"')}"`,
    Limit: 10
  }));

  const users = response.Users ?? [];
  return users.find((user) => String(user.Username || "").trim() !== "") ?? null;
}

function isNativeCognitoUser(user: CognitoUserSnapshot | null | undefined) {
  return !getAttribute(user?.UserAttributes, "identities");
}

export async function linkExternalProviderToNativeUser(event: CognitoTriggerEvent, email: string) {
  const { providerName, providerUserId } = parseProviderUserName(event.userName);
  if (!providerName || !providerUserId) return;

  const existingUser = await findExistingUserByEmail(event.userPoolId, email);
  const existingUsername = String(existingUser?.Username || "");
  const existingUserSnapshot = existingUser
    ? { Username: existingUser.Username, UserStatus: existingUser.UserStatus, UserAttributes: existingUser.Attributes }
    : null;

  if (!existingUser || !existingUsername || existingUsername.startsWith(`${providerName}_`)) return;
  if (!isNativeCognitoUser(existingUserSnapshot)) return;

  await client.send(new AdminLinkProviderForUserCommand({
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
