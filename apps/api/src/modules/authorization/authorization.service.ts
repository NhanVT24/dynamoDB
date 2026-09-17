import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CognitoIdentityProviderClient, ListUsersCommand, type AttributeType } from "@aws-sdk/client-cognito-identity-provider";
import { env } from "../../config/env.js";
import type { ProductPermission } from "../../common/auth/permissions.js";
import {
  addUserPermission,
  getUserAccountStatus,
  getUserPermissions,
  getUserProfileSummary,
  normalizeUserAccountStatus,
  removeUserPermission,
  updateUserAccountStatus,
  type UserAccountStatus
} from "./authorization.repository.js";

const cognito = new CognitoIdentityProviderClient({ region: env.AWS_REGION });

function attribute(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((item) => item.Name === name)?.Value?.trim() ?? "";
}

@Injectable()
export class AuthorizationService {
  async listUsers() {
    const users = await this.listCognitoUsers();
    return Promise.all(users.map(async (user) => {
      const [profile, permissions] = await Promise.all([
        getUserProfileSummary(user.subject),
        getUserPermissions(user.subject)
      ]);
      return {
        ...user,
        ...profile,
        permissions
      };
    }));
  }

  private async listCognitoUsers() {
    if (!env.COGNITO_USER_POOL_ID) throw new Error("Missing COGNITO_USER_POOL_ID configuration.");
    const response = await cognito.send(new ListUsersCommand({
      UserPoolId: env.COGNITO_USER_POOL_ID,
      Limit: 60
    }));

    return (response.Users ?? [])
      .filter((user) => user.Enabled && attribute(user.Attributes, "sub"))
      .map((user) => ({
        subject: attribute(user.Attributes, "sub"),
        username: String(user.Username ?? ""),
        email: attribute(user.Attributes, "email").toLowerCase(),
        displayName: attribute(user.Attributes, "name") || attribute(user.Attributes, "email")
      }));
  }

  async addPermission(subject: string, permission: ProductPermission, actorSubject: string) {
    await this.assertUserExists(subject);
    return { subject, permissions: await addUserPermission(subject, permission, actorSubject) };
  }

  async removePermission(subject: string, permission: ProductPermission, actorSubject: string) {
    await this.assertUserExists(subject);
    return { subject, permissions: await removeUserPermission(subject, permission, actorSubject) };
  }

  async updateAccountStatus(subject: string, status: UserAccountStatus, actorSubject: string) {
    await this.assertUserExists(subject);
    const normalizedStatus = normalizeUserAccountStatus(status);
    if (subject === actorSubject && normalizedStatus !== "ACTIVE") {
      throw new BadRequestException("You cannot block your own account.");
    }
    return { subject, accountStatus: await updateUserAccountStatus(subject, normalizedStatus, actorSubject) };
  }

  private async assertUserExists(subject: string) {
    const users = await this.listCognitoUsers();
    if (!users.some((user) => user.subject === subject)) {
      throw new NotFoundException("Cognito user not found");
    }
  }
}
