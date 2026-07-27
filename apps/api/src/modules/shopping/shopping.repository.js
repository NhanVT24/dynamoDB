import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { keys } from "../../db/keys.js";

const TableName = env.DYNAMODB_TABLE_NAME;
const INCREMENTABLE_FIELDS = new Set(["quantity"]);

function encodeCursor(key) {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

export async function createShoppingItem(input) {
  const now = new Date().toISOString();
  const item = {
    ...input,
    id: crypto.randomUUID(),
    entityType: "SHOPPING_ITEM",
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  await db.send(new PutCommand({
    TableName,
    Item: {
      ...keys.shoppingItem(item.id),
      ...item,
      GSI1PK: `CATEGORY#${item.category.toLowerCase()}`,
      GSI1SK: `ITEM#${item.name.toLowerCase()}#${item.id}`
    },
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return item;
}

export async function getShoppingItem(id) {
  const result = await db.send(new GetCommand({
    TableName,
    Key: keys.shoppingItem(id),
    ConsistentRead: true
  }));

  return result.Item ?? null;
}

export async function incrementItemValue(id, field, incrementBy = 1) {
  if (!INCREMENTABLE_FIELDS.has(field)) {
    throw new Error(`Field "${field}" is not allowed for increment.`);
  }

  const isDecrease = incrementBy < 0;
  const conditionExpression = isDecrease
    ? "attribute_exists(PK) AND #field >= :minBeforeDecrease"
    : "attribute_exists(PK)";
  const expressionAttributeValues = {
    ":zero": 0,
    ":one": 1,
    ":incrementBy": incrementBy,
    ":updatedAt": new Date().toISOString()
  };

  if (isDecrease) {
    expressionAttributeValues[":minBeforeDecrease"] = Math.abs(incrementBy) + 1;
  }

  const result = await db.send(new UpdateCommand({
    TableName,
    Key: keys.shoppingItem(id),
    UpdateExpression: [
      "SET #field = if_not_exists(#field, :zero) + :incrementBy",
      "updatedAt = :updatedAt",
      "#version = if_not_exists(#version, :zero) + :one"
    ].join(", "),
    ConditionExpression: conditionExpression,
    ExpressionAttributeNames: {
      "#field": field,
      "#version": "version"
    },
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "ALL_NEW"
  }));

  return result.Attributes;
}

export async function listShoppingItems(limit = 50, cursor) {
  const ExclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

  const result = await db.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :type",
    ExpressionAttributeValues: { ":type": "SHOPPING_ITEM" },
    Limit: limit,
    ExclusiveStartKey
  }));

  return {
    items: result.Items ?? [],
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null
  };
}

export async function getShoppingItemAll(pageLimit = 50, maxPages = 20) {
  const allItems = [];
  let cursor;
  let page = 0;

  do {
    const result = await listShoppingItems(pageLimit, cursor);
    allItems.push(...result.items);
    cursor = result.nextCursor;
    page += 1;
  } while (cursor && page < maxPages);

  return {
    items: allItems,
    nextCursor: cursor ?? null,
    stoppedByMaxPages: Boolean(cursor)
  };
}

export async function listShoppingItemsByPage(page = 1, limit = 10) {
  let cursor;
  let currentPage = 1;
  let result = { items: [], nextCursor: null };

  while (currentPage <= page) {
    result = await listShoppingItems(limit, cursor);
    cursor = result.nextCursor;

    if (currentPage === page) break;
    if (!cursor) {
      return {
        items: [],
        page,
        limit,
        hasNextPage: false,
        hasPreviousPage: page > 1,
        nextPage: null,
        previousPage: page > 1 ? page - 1 : null
      };
    }

    currentPage += 1;
  }

  return {
    items: result.items,
    page,
    limit,
    hasNextPage: Boolean(result.nextCursor),
    hasPreviousPage: page > 1,
    nextPage: result.nextCursor ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null
  };
}

export async function updateShoppingItem(id, patch, version) {
  const names = { "#version": "version" };
  const values = {
    ":expectedVersion": version,
    ":one": 1,
    ":updatedAt": new Date().toISOString()
  };
  const setters = ["updatedAt = :updatedAt", "#version = #version + :one"];

  for (const [field, value] of Object.entries(patch)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    setters.push(`#${field} = :${field}`);
  }

  if (patch.category) {
    names["#GSI1PK"] = "GSI1PK";
    values[":GSI1PK"] = `CATEGORY#${patch.category.toLowerCase()}`;
    setters.push("#GSI1PK = :GSI1PK");
  }

  const result = await db.send(new UpdateCommand({
    TableName,
    Key: keys.shoppingItem(id),
    UpdateExpression: `SET ${setters.join(", ")}`,
    ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW"
  }));

  return result.Attributes;
}

export async function deleteShoppingItem(id) {
  await db.send(new DeleteCommand({
    TableName,
    Key: keys.shoppingItem(id),
    ConditionExpression: "attribute_exists(PK)"
  }));
}
