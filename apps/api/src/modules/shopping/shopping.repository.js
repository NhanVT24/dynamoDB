import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../db/client.js";
import { keys } from "../../db/keys.js";

const TableName = env.DYNAMODB_TABLE_NAME;
const INCREMENTABLE_FIELDS = new Set(["stock", "soldCount"]);

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function deriveStatus(stock) {
  if (stock <= 0) return "out_of_stock";
  if (stock <= 10) return "low_stock";
  return "active";
}

function buildIndexes(product) {
  return {
    GSI1PK: `CATEGORY#${normalizeText(product.category)}`,
    GSI1SK: `STATUS#${product.status}#NAME#${normalizeText(product.name)}#PRODUCT#${product.id}`
  };
}

function toProductRecord(input, current) {
  const stock = input.stock ?? current?.stock ?? 0;
  const status = deriveStatus(stock);
  return {
    ...current,
    ...input,
    stock,
    status,
    originalPrice: input.originalPrice ?? current?.originalPrice ?? input.price ?? current?.price ?? 0
  };
}

function toDynamoItem(item) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item) {
  return item ? unmarshall(item) : null;
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

function matchesFilters(item, filters = {}) {
  if (!item || item.entityType !== "PRODUCT") return false;
  if (filters.category && filters.category !== "all" && item.category !== filters.category) return false;
  if (filters.status && item.status !== filters.status) return false;

  if (filters.search) {
    const search = normalizeText(filters.search);
    const haystack = [
      item.name,
      item.description,
      item.brand,
      item.sku,
      item.category
    ]
      .filter(Boolean)
      .map(normalizeText)
      .join(" ");

    if (!haystack.includes(search)) return false;
  }

  return true;
}

async function scanUntilEnough(limit, cursor, filters = {}) {
  const results = [];
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null, scannedCount: 0 };
  const batchSize = Math.max(limit * 3);

  while (results.length < limit) {
    const result = await rawDb.send(new ScanCommand({
      TableName,
      Limit: batchSize,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const [index, rawItem] of rawItems.entries()) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        const itemCursor = {
          PK: rawItem.PK,
          SK: rawItem.SK
        };
        const hasMoreItemsInCurrentBatch = index < rawItems.length - 1;
        const hasMoreItemsInNextBatch = Boolean(result.LastEvaluatedKey);
        const nextCursor = hasMoreItemsInCurrentBatch || hasMoreItemsInNextBatch
          ? encodeCursor({
            lastKey: itemCursor,
            scannedCount: state.scannedCount + (result.ScannedCount ?? 0)
          })
          : null;

        return {
          items: results,
          nextCursor,
          scannedCount: state.scannedCount + (result.ScannedCount ?? 0)
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
      scannedCount: state.scannedCount + (result.ScannedCount ?? 0)
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
        scannedCount: state.scannedCount
      };
    }
  }

  return {
    items: results,
    nextCursor: state.lastKey ? encodeCursor(state) : null,
    scannedCount: state.scannedCount
  };
}

export async function createShoppingItem(input) {
  const now = new Date().toISOString();
  const item = toProductRecord(
    {
      ...input,
      id: crypto.randomUUID(),
      entityType: "PRODUCT",
      searchName: normalizeText(input.name),
      version: 1,
      createdAt: now,
      updatedAt: now
    },
    null
  );

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem({
      ...keys.product(item.id),
      ...item,
      ...buildIndexes(item)
    }),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return item;
}

export async function getShoppingItem(id) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConsistentRead: true
  }));

  return fromDynamoItem(result.Item);
}

export async function incrementItemValue(id, field, incrementBy = 1) {
  if (!INCREMENTABLE_FIELDS.has(field)) {
    throw new Error(`Field "${field}" is not allowed for increment.`);
  }

  const current = await getShoppingItem(id);
  if (!current) {
    const error = new Error("Product not found");
    error.name = "ConditionalCheckFailedException";
    throw error;
  }

  const nextValue = Math.max(0, Number(current[field] ?? 0) + incrementBy);
  const nextRecord = toProductRecord(
    {
      [field]: nextValue,
      updatedAt: new Date().toISOString()
    },
    current
  );
  const indexes = buildIndexes(nextRecord);

  const result = await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    UpdateExpression: [
      "SET #field = :fieldValue",
      "#status = :status",
      "#gsi1pk = :gsi1pk",
      "#gsi1sk = :gsi1sk",
      "updatedAt = :updatedAt",
      "#version = #version + :one"
    ].join(", "),
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#field": field,
      "#status": "status",
      "#gsi1pk": "GSI1PK",
      "#gsi1sk": "GSI1SK",
      "#version": "version"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":fieldValue": nextValue,
      ":status": nextRecord.status,
      ":gsi1pk": indexes.GSI1PK,
      ":gsi1sk": indexes.GSI1SK,
      ":updatedAt": nextRecord.updatedAt,
      ":one": 1
    }),
    ReturnValues: "ALL_NEW"
  }));

  return fromDynamoItem(result.Attributes);
}

export async function listShoppingItems(limit = 12, cursor, filters = {}) {
  const result = await scanUntilEnough(limit, cursor, filters);

  return {
    items: result.items,
    limit,
    cursor: cursor ?? null,
    nextCursor: result.nextCursor,
    hasNextPage: Boolean(result.nextCursor)
  };
}

export async function getShoppingItemAll(pageLimit = 50, maxPages = 20, filters = {}) {
  const allItems = [];
  let cursor;
  let page = 0;

  do {
    const result = await listShoppingItems(pageLimit, cursor, filters);
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

export async function listShoppingItemsByPage(page = 1, limit = 12, filters = {}) {
  let currentPage = 1;
  let cursor;
  let result = { items: [], nextCursor: null };

  while (currentPage <= page) {
    result = await listShoppingItems(limit, cursor, filters);

    if (currentPage === page) {
      break;
    }

    if (!result.nextCursor) {
      return {
        items: [],
        page,
        limit,
        totalItems: null,
        totalPages: null,
        hasNextPage: false,
        hasPreviousPage: page > 1,
        nextPage: null,
        previousPage: page > 1 ? page - 1 : null
      };
    }

    cursor = result.nextCursor;
    currentPage += 1;
  }

  const summary = await getShoppingItemAll(100, 100, filters);
  const totalItems = summary.items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return {
    items: result.items,
    page: Math.min(page, totalPages),
    limit,
    totalItems,
    totalPages,
    hasNextPage: Boolean(result.nextCursor),
    hasPreviousPage: page > 1,
    nextPage: result.nextCursor ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null
  };
}

export async function updateShoppingItem(id, patch, version) {
  const current = await getShoppingItem(id);
  if (!current) {
    const error = new Error("Product not found");
    error.name = "ConditionalCheckFailedException";
    throw error;
  }

  const merged = toProductRecord(
    {
      ...patch,
      updatedAt: new Date().toISOString()
    },
    current
  );
  const indexes = buildIndexes(merged);
  const names = {
    "#version": "version",
    "#gsi1pk": "GSI1PK",
    "#gsi1sk": "GSI1SK",
    "#status": "status",
    "#searchName": "searchName"
  };
  const values = {
    ":expectedVersion": version,
    ":one": 1,
    ":updatedAt": merged.updatedAt,
    ":gsi1pk": indexes.GSI1PK,
    ":gsi1sk": indexes.GSI1SK,
    ":status": merged.status,
    ":searchName": normalizeText(merged.name)
  };
  const setters = [
    "updatedAt = :updatedAt",
    "#version = #version + :one",
    "#gsi1pk = :gsi1pk",
    "#gsi1sk = :gsi1sk",
    "#status = :status",
    "#searchName = :searchName"
  ];

  for (const [field, value] of Object.entries(patch)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    setters.push(`#${field} = :${field}`);
  }

  if (!Object.hasOwn(patch, "originalPrice")) {
    names["#originalPrice"] = "originalPrice";
    values[":originalPrice"] = merged.originalPrice;
    setters.push("#originalPrice = :originalPrice");
  }

  const result = await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    UpdateExpression: `SET ${setters.join(", ")}`,
    ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: toDynamoItem(values),
    ReturnValues: "ALL_NEW"
  }));

  return fromDynamoItem(result.Attributes);
}

export async function deleteShoppingItem(id) {
  await rawDb.send(new DeleteItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConditionExpression: "attribute_exists(PK)"
  }));
}
