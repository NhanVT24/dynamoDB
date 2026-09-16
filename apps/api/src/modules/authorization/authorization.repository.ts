import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { keys } from "../../database/dynamodb/keys.js";
import { normalizePermissions, type ProductPermission } from "../../common/auth/permissions.js";

const TableName = env.DYNAMODB_TABLE_NAME;

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

export async function addUserPermission(subject: string, permission: ProductPermission, updatedBy: string) {
  const now = new Date().toISOString();
  const key = keys.userAuthorization(subject);
  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: marshall(key),
    UpdateExpression: "SET #entityType = :entityType, #subject = :subject, #updatedAt = :updatedAt, #updatedBy = :updatedBy ADD #permissions :permission",
    ExpressionAttributeNames: {
      "#entityType": "entityType",
      "#subject": "subject",
      "#updatedAt": "updatedAt",
      "#updatedBy": "updatedBy",
      "#permissions": "permissions"
    },
    ExpressionAttributeValues: marshall({
      ":entityType": "USER_AUTHORIZATION",
      ":subject": subject,
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":permission": new Set([permission])
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
    UpdateExpression: "SET #updatedAt = :updatedAt, #updatedBy = :updatedBy DELETE #permissions :permission",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#updatedAt": "updatedAt",
      "#updatedBy": "updatedBy",
      "#permissions": "permissions"
    },
    ExpressionAttributeValues: marshall({
      ":updatedAt": now,
      ":updatedBy": updatedBy,
      ":permission": new Set([permission])
    })
  })).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });

  return getUserPermissions(subject);
}
