import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { keys } from "../../database/dynamodb/keys.js";
import { normalizePermissions, type ProductPermission } from "../../common/auth/permissions.js";

const TableName = env.DYNAMODB_TABLE_NAME;
export type UserAccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED";
export type UserAddress = {
  ward: string;
  city: string;
  province: string;
};
const accountStatuses = new Set<UserAccountStatus>(["ACTIVE", "SUSPENDED", "DISABLED", "BLOCKED"]);

export function normalizeUserAccountStatus(status: unknown): UserAccountStatus {
  const normalized = String(status || "").trim().toUpperCase();
  return accountStatuses.has(normalized as UserAccountStatus) ? normalized as UserAccountStatus : "ACTIVE";
}

export async function getUserPermissions(subject: string): Promise<ProductPermission[]> {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: marshall(keys.userAuthorization(subject)),
    ConsistentRead: true,
    ProjectionExpression: "#permissions",
    ExpressionAttributeNames: {
      "#permissions": "permissions"
    }
  }));

  return result.Item ? normalizePermissions(unmarshall(result.Item).permissions) : [];
}

export async function getUserAccountStatus(subject: string): Promise<UserAccountStatus> {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: marshall(keys.userProfile(subject)),
    ConsistentRead: true,
    ProjectionExpression: "#status",
    ExpressionAttributeNames: {
      "#status": "status"
    }
  }));

  return normalizeUserAccountStatus(result.Item ? unmarshall(result.Item).status : undefined);
}

function normalizeAddresses(value: unknown): UserAddress[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const address = item as Record<string, unknown>;
    const ward = String(address.ward || "").trim();
    const city = String(address.city || "").trim();
    const province = String(address.province || "").trim();
    return ward && city && province ? [{ ward, city, province }] : [];
  });
}

export async function getUserProfileSummary(subject: string): Promise<{ accountStatus: UserAccountStatus; lastLoginAt: string; displayName: string; addresses: UserAddress[] }> {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: marshall(keys.userProfile(subject)),
    ConsistentRead: true,
    ProjectionExpression: "#status, #lastLoginAt, #displayName, #addresses",
    ExpressionAttributeNames: {
      "#status": "status",
      "#lastLoginAt": "lastLoginAt",
      "#displayName": "displayName",
      "#addresses": "addresses"
    }
  }));

  const profile = result.Item ? unmarshall(result.Item) : {};
  return {
    accountStatus: normalizeUserAccountStatus(profile.status),
    lastLoginAt: String(profile.lastLoginAt || ""),
    displayName: String(profile.displayName || ""),
    addresses: normalizeAddresses(profile.addresses)
  };
}

export async function updateUserAccountStatus(subject: string, status: UserAccountStatus, updatedBy: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: marshall(keys.userProfile(subject)),
    UpdateExpression: "SET #entityType = if_not_exists(#entityType, :entityType), #subject = if_not_exists(#subject, :subject), #status = :status, #updatedAt = :updatedAt, #statusUpdatedAt = :updatedAt, #statusUpdatedBy = :updatedBy, #auditActorId = :updatedBy, #auditActorType = :auditActorType, #auditActorRole = :auditActorRole, #auditSource = :auditSource, #auditReason = :auditReason, #auditRequestId = :auditRequestId",
    ExpressionAttributeNames: {
      "#entityType": "entityType",
      "#subject": "subject",
      "#status": "status",
      "#updatedAt": "updatedAt",
      "#statusUpdatedAt": "statusUpdatedAt",
      "#statusUpdatedBy": "statusUpdatedBy",
      "#auditActorId": "auditActorId",
      "#auditActorType": "auditActorType",
      "#auditActorRole": "auditActorRole",
      "#auditSource": "auditSource",
      "#auditReason": "auditReason",
      "#auditRequestId": "auditRequestId"
    },
    ExpressionAttributeValues: marshall({
      ":entityType": "USER_PROFILE",
      ":subject": subject,
      ":status": status,
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":auditActorType": "ADMIN",
      ":auditActorRole": "admin",
      ":auditSource": "ADMIN_AUTHORIZATION_API",
      ":auditReason": "account_status_updated",
      ":auditRequestId": `${subject}:status:${now}`
    })
  }));

  return getUserAccountStatus(subject);
}

export async function updateUserAddresses(subject: string, addresses: UserAddress[], updatedBy: string) {
  const now = new Date().toISOString();
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: marshall(keys.userProfile(subject)),
    UpdateExpression: "SET #entityType = if_not_exists(#entityType, :entityType), #subject = if_not_exists(#subject, :subject), #addresses = :addresses, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #auditActorId = :updatedBy, #auditActorType = :auditActorType, #auditActorRole = :auditActorRole, #auditSource = :auditSource, #auditReason = :auditReason, #auditRequestId = :auditRequestId",
    ExpressionAttributeNames: {
      "#entityType": "entityType",
      "#subject": "subject",
      "#addresses": "addresses",
      "#updatedAt": "updatedAt",
      "#updatedBy": "updatedBy",
      "#auditActorId": "auditActorId",
      "#auditActorType": "auditActorType",
      "#auditActorRole": "auditActorRole",
      "#auditSource": "auditSource",
      "#auditReason": "auditReason",
      "#auditRequestId": "auditRequestId"
    },
    ExpressionAttributeValues: marshall({
      ":entityType": "USER_PROFILE",
      ":subject": subject,
      ":addresses": addresses,
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":auditActorType": "ADMIN",
      ":auditActorRole": "admin",
      ":auditSource": "ADMIN_PROFILE_API",
      ":auditReason": "addresses_updated",
      ":auditRequestId": `${subject}:addresses:${now}`
    })
  }));

  return normalizeAddresses(addresses);
}

export async function addUserPermission(subject: string, permission: ProductPermission, updatedBy: string) {
  const now = new Date().toISOString();
  const key = keys.userAuthorization(subject);
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: marshall(key),
    UpdateExpression: "SET #entityType = :entityType, #subject = :subject, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #auditActorId = :updatedBy, #auditActorType = :auditActorType, #auditActorRole = :auditActorRole, #auditSource = :auditSource, #auditReason = :auditReason, #auditRequestId = :auditRequestId ADD #permissions :permission",
    ExpressionAttributeNames: {
      "#entityType": "entityType",
      "#subject": "subject",
      "#updatedAt": "updatedAt",
      "#updatedBy": "updatedBy",
      "#permissions": "permissions",
      "#auditActorId": "auditActorId",
      "#auditActorType": "auditActorType",
      "#auditActorRole": "auditActorRole",
      "#auditSource": "auditSource",
      "#auditReason": "auditReason",
      "#auditRequestId": "auditRequestId"
    },
    ExpressionAttributeValues: marshall({
      ":entityType": "USER_AUTHORIZATION",
      ":subject": subject,
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":permission": new Set([permission]),
      ":auditActorType": "ADMIN",
      ":auditActorRole": "admin",
      ":auditSource": "ADMIN_AUTHORIZATION_API",
      ":auditReason": "permission_granted",
      ":auditRequestId": `${subject}:${permission}:${now}`
    }),
    ReturnValues: "ALL_NEW"
  }));

  return getUserPermissions(subject);
}

export async function removeUserPermission(subject: string, permission: ProductPermission, updatedBy: string) {
  const now = new Date().toISOString();
  const key = keys.userAuthorization(subject);
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: marshall(key),
    UpdateExpression: "SET #updatedAt = :updatedAt, #updatedBy = :updatedBy, #auditActorId = :updatedBy, #auditActorType = :auditActorType, #auditActorRole = :auditActorRole, #auditSource = :auditSource, #auditReason = :auditReason, #auditRequestId = :auditRequestId DELETE #permissions :permission",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#updatedAt": "updatedAt",
      "#updatedBy": "updatedBy",
      "#permissions": "permissions",
      "#auditActorId": "auditActorId",
      "#auditActorType": "auditActorType",
      "#auditActorRole": "auditActorRole",
      "#auditSource": "auditSource",
      "#auditReason": "auditReason",
      "#auditRequestId": "auditRequestId"
    },
    ExpressionAttributeValues: marshall({
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":permission": new Set([permission]),
      ":auditActorType": "ADMIN",
      ":auditActorRole": "admin",
      ":auditSource": "ADMIN_AUTHORIZATION_API",
      ":auditReason": "permission_revoked",
      ":auditRequestId": `${subject}:${permission}:${now}`
    })
  })).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });

  return getUserPermissions(subject);
}
