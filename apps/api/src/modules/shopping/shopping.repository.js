import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../db/client.js";
import { keys } from "../../db/keys.js";
import { getMockShoppingItem, listMockShoppingItems } from "./shopping.mock.js";

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



function toProductRecord(input, current) {
  const stock = input.stock ?? current?.stock ?? 0;
  const status = deriveStatus(stock);
  return {
    ...current,
    ...input,
    stock,
    status,
    searchField: input.searchField ?? current?.searchField ?? "name",
    searchName: normalizeText(input.name ?? current?.name ?? ""),
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
  if (
    filters.category &&
    filters.category !== "all" &&
    normalizeText(item.category) !== normalizeText(filters.category)
  ) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (
    filters.updatedAtFrom &&
    String(item.updatedAt ?? item.createdAt ?? "") < String(filters.updatedAtFrom)
  ) return false;

  if (filters.search) {
    const search = normalizeText(filters.search);
    const searchField = filters.searchField ?? "name";
    if (searchField === "name") {
      const normalizedName = normalizeText(item.name);
      if (!normalizedName.startsWith(search)) return false;
    } else {
      const haystack = [item.brand]
        .filter(Boolean)
        .map(normalizeText)
        .join(" ");

      if (!haystack.includes(search)) return false;
    }
  }

  return true;
}

function sortItems(items, filters = {}) {
  if (!filters.sortBy) {
    return [...items].sort((left, right) =>
      String(right?.updatedAt ?? right?.createdAt ?? "").localeCompare(
        String(left?.updatedAt ?? left?.createdAt ?? "")
      )
    );
  }

  const direction = filters.sortDirection === "asc" ? 1 : -1;
  const field = filters.sortBy;

  return [...items].sort((left, right) => {
    const leftValue = Number(left?.[field] ?? 0);
    const rightValue = Number(right?.[field] ?? 0);

    if (leftValue === rightValue) {
      return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
    }

    return (leftValue - rightValue) * direction;
  });
}

async function listShoppingItemsBase(limit = 12, cursor, filters = {}) {
  let result;

  try {
    if (filters.status) {
      result = await queryStatusUpdatedAtWithSearchFilterUntilEnough(limit, cursor, filters);
    } else if (filters.search || filters.updatedAtFrom) {
      result = (filters.searchField ?? "name") === "brand" && filters.search
        ? await scanBrandSearchUntilEnough(limit, cursor, filters)
        : filters.search
          ? await querySearchUntilEnough(limit, cursor, filters)
          : await scanUntilEnough(limit, cursor, filters);
    } else if (filters.category && filters.category !== "all") {
      result = await queryCategoryStatusNameUntilEnough(limit, cursor, filters);
    } else {
      result = await scanUntilEnough(limit, cursor, filters);
    }
  } catch (error) {
    if (
      error?.name !== "ValidationException" &&
      error?.name !== "ResourceNotFoundException"
    ) {
      throw error;
    }

    result = (filters.searchField ?? "name") === "brand" && filters.search
      ? await scanBrandSearchUntilEnough(limit, cursor, filters)
      : await scanUntilEnough(limit, cursor, filters);
  }

  return {
    items: result.items,
    limit,
    cursor: cursor ?? null,
    nextCursor: result.nextCursor,
    hasNextPage: Boolean(result.nextCursor)
  };
}

async function scanUntilEnough(limit, cursor, filters = {}) {
  const results = [];
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey
          ? encodeCursor({ lastKey: state.lastKey })
          : null
      };
    }

    const result = await rawDb.send(new ScanCommand({
      TableName,
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const rawItem of rawItems) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({
              lastKey: result.LastEvaluatedKey,
            })
            : null
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
      };
    }
  }
}

async function scanBrandSearchUntilEnough(limit, cursor, filters = {}) {
  const results = [];
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey
          ? encodeCursor({ lastKey: state.lastKey })
          : null
      };
    }

    const result = await rawDb.send(new ScanCommand({
      TableName,
      FilterExpression: "contains(#brand, :brandValue)",
      ExpressionAttributeNames: {
        "#brand": "brand"
      },
      ExpressionAttributeValues: toDynamoItem({
        ":brandValue": String(filters.search ?? "").trim()
      }),
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const rawItem of rawItems) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
      };
    }
  }
}

function buildStatusTimelineExpressions(filters = {}) {
  const search = filters.search ? normalizeText(filters.search) : null;
  const searchField = filters.searchField ?? "name";
  const expressionAttributeNames = {
    "#status": "status"
  };
  const expressionAttributeValues = {
    ":statusKey": filters.status
  };
  const keyConditionParts = ["#status = :statusKey"];
  let filterExpression;

  if (filters.updatedAtFrom) {
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAtFrom"] = filters.updatedAtFrom;
    keyConditionParts.push("#updatedAt >= :updatedAtFrom");
  }

  if (search && searchField === "brand") {
    expressionAttributeNames["#brand"] = "brand";
    expressionAttributeValues[":brandValue"] = String(filters.search ?? "").trim();
    filterExpression = "contains(#brand, :brandValue)";
  }

  return {
    KeyConditionExpression: keyConditionParts.join(" AND "),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: toDynamoItem(expressionAttributeValues),
    FilterExpression: filterExpression
  };
}

async function queryStatusUpdatedAtWithSearchFilterUntilEnough(limit, cursor, filters = {}) {
  if (!filters.status) {
    if ((filters.searchField ?? "name") === "brand" && filters.search) {
      return scanBrandSearchUntilEnough(limit, cursor, filters);
    }

    if (filters.search) {
      return querySearchUntilEnough(limit, cursor, filters);
    }

    return scanUntilEnough(limit, cursor, filters);
  }

  const results = [];
  const search = filters.search ? normalizeText(filters.search) : null;
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey
          ? encodeCursor({ lastKey: state.lastKey })
          : null
      };
    }

    const result = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "StatusTimelineIndex",
      KeyConditionExpression: "#status = :statusKey AND #updatedAt >= :updatedAtFrom",
      // KeyConditionExpression: "status = :statusKey AND updatedAt >= :updatedAtFrom AND begins_with(searchName, :searchPrefix)",
      ExpressionAttributeNames: {
        "#status": "status",
        "#updatedAt": "updatedAt",
        "#searchName": "searchName"
      },
      ExpressionAttributeValues: toDynamoItem({
        ":statusKey": filters.status,
        ":updatedAtFrom": filters.updatedAtFrom,
        ":searchPrefix": search
      }),
      FilterExpression: "begins_with(#searchName, :searchPrefix)",
      ScanIndexForward: false,
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const rawItem of rawItems) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({
              lastKey: result.LastEvaluatedKey,
            })
            : null
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
      };
    }
  }
}
function buildCategoryStatusNameQuery(filters = {}) {
  const search = filters.search ? normalizeText(filters.search) : null;
  const expressionParts = ["category = :categoryKey"];
  const values = {
    ":categoryKey": filters.category
  };
  const names = {};

  if (filters.status) {
    expressionParts.push("#status = :statusKey");
    names["#status"] = "status";
    values[":statusKey"] = filters.status;
  }

  if (search) {
    expressionParts.push("begins_with(searchName, :searchPrefix)");
    values[":searchPrefix"] = search;
  }

  return {
    KeyConditionExpression: expressionParts.join(" AND "),
    ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
    ExpressionAttributeValues: toDynamoItem(values)
  };
}

async function queryCategoryStatusNameUntilEnough(limit, cursor, filters = {}) {
  const results = [];
  const queryInput = buildCategoryStatusNameQuery(filters);
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey
          ? encodeCursor({ lastKey: state.lastKey })
          : null
      };
    }

    const result = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "CategoryStatusNameIndex",
      ...queryInput,
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const rawItem of rawItems) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
      };
    }
  }
}

async function querySearchUntilEnough(limit, cursor, filters = {}) {
  if ((filters.searchField ?? "name") === "brand") {
    return scanBrandSearchUntilEnough(limit, cursor, filters);
  }

  const results = [];
  const search = normalizeText(filters.search);
  let state = cursor
    ? decodeCursor(cursor)
    : { lastKey: null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey
          ? encodeCursor({ lastKey: state.lastKey })
          : null
      };
    }

    const result = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "SearchNameIndex",
      KeyConditionExpression: "searchField = :fieldName AND begins_with(searchName, :searchPrefix)",
      ExpressionAttributeValues: toDynamoItem({
        ":fieldName": "name",
        ":searchPrefix": search
      }),
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    const rawItems = result.Items ?? [];

    for (const rawItem of rawItems) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = {
      lastKey: result.LastEvaluatedKey ?? null,
    };

    if (!result.LastEvaluatedKey) {
      return {
        items: results,
        nextCursor: null,
      };
    }
  }
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
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    },
    null
  );

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem({
      ...keys.product(item.id),
      ...item
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

  const result = await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    UpdateExpression: [
      "SET #field = :fieldValue",
      "#status = :status",
      "#searchName = :searchName",
      "updatedAt = :updatedAt",
      "#version = #version + :one"
    ].join(", "),
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#field": field,
      "#status": "status",
      "#searchName": "searchName",
      "#version": "version"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":fieldValue": nextValue,
      ":status": nextRecord.status,
      ":searchName": nextRecord.searchName,
      ":updatedAt": nextRecord.updatedAt,
      ":one": 1
    }),
    ReturnValues: "ALL_NEW"
  }));

  return fromDynamoItem(result.Attributes);
}

export async function listShoppingItems(limit = 12, cursor, filters = {}) {
  if (filters.sortBy) {
    const targetCursor = cursor ? decodeCursor(cursor) : { offset: 0 };
    const sorted = sortItems((await getShoppingItemAllBase(100, 100, {
      ...filters,
      sortBy: undefined,
      sortDirection: undefined
    })).items, filters);
    const offset = Math.max(0, Number(targetCursor.offset) || 0);
    const items = sorted.slice(offset, offset + limit);
    const nextOffset = offset + items.length;

    return {
      items,
      limit,
      cursor: cursor ?? null,
      nextCursor: nextOffset < sorted.length
        ? encodeCursor({ offset: nextOffset })
        : null,
      hasNextPage: nextOffset < sorted.length
    };
  }

  const baseResult = await listShoppingItemsBase(limit, cursor, filters);
  if (!cursor) {
    return {
      ...baseResult,
      items: sortItems(baseResult.items, {})
    };
  }

  return baseResult;
}

export async function getCursorForPage(page = 1, limit = 12, filters = {}) {
  if (filters.sortBy) {
    const targetPage = Math.max(1, Number(page) || 1);
    const pageSize = Math.max(1, Number(limit) || 12);
    const sorted = sortItems((await getShoppingItemAllBase(100, 100, {
      ...filters,
      sortBy: undefined,
      sortDirection: undefined
    })).items, filters);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const resolvedPage = Math.min(targetPage, totalPages);
    const resolvedOffset = (resolvedPage - 1) * pageSize;
    const cursorHistory = Array.from({ length: resolvedPage }, (_, index) =>
      index === 0 ? null : encodeCursor({ offset: index * pageSize })
    );

    return {
      page: resolvedPage,
      requestedPage: targetPage,
      cursor: resolvedOffset > 0 ? encodeCursor({ offset: resolvedOffset }) : null,
      cursorHistory,
      hasNextPage: resolvedOffset + pageSize < sorted.length,
      nextCursor: resolvedOffset + pageSize < sorted.length
        ? encodeCursor({ offset: resolvedOffset + pageSize })
        : null,
      reachedEnd: resolvedPage < targetPage
    };
  }

  const targetPage = Math.max(1, Number(page) || 1);
  const pageSize = Math.max(1, Number(limit) || 12);
  const cursorHistory = [null];
  let currentCursor = null;
  let currentPage = 1;
  let result = await listShoppingItems(pageSize, currentCursor, filters);

  while (currentPage < targetPage && result.nextCursor) {
    currentCursor = result.nextCursor;
    cursorHistory.push(currentCursor);
    currentPage += 1;
    result = await listShoppingItems(pageSize, currentCursor, filters);
  }

  return {
    page: currentPage,
    requestedPage: targetPage,
    cursor: cursorHistory[currentPage - 1] ?? null,
    cursorHistory,
    hasNextPage: Boolean(result.nextCursor),
    nextCursor: result.nextCursor ?? null,
    reachedEnd: currentPage < targetPage
  };
}

export { getMockShoppingItem, listMockShoppingItems };

export async function getShoppingItemAll(pageLimit = 50, maxPages = 20, filters = {}) {
  if (filters.sortBy) {
    const unsorted = await getShoppingItemAllBase(pageLimit, maxPages, {
      ...filters,
      sortBy: undefined,
      sortDirection: undefined
    });

    return {
      items: sortItems(unsorted.items, filters),
      nextCursor: unsorted.nextCursor ?? null,
      stoppedByMaxPages: unsorted.stoppedByMaxPages
    };
  }

  const base = await getShoppingItemAllBase(pageLimit, maxPages, filters);
  return {
    ...base,
    items: sortItems(base.items, {})
  };
}

async function getShoppingItemAllBase(pageLimit = 50, maxPages = 20, filters = {}) {
  const allItems = [];
  let cursor;
  let page = 0;

  do {
    const result = await listShoppingItemsBase(pageLimit, cursor, filters);
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
  const names = {
    "#version": "version",
    "#status": "status",
    "#searchName": "searchName",
    "#searchField": "searchField"
  };
  const values = {
    ":expectedVersion": version,
    ":one": 1,
    ":updatedAt": merged.updatedAt,
    ":status": merged.status,
    ":searchName": normalizeText(merged.name),
    ":searchField": merged.searchField ?? "name"
  };
  const setters = [
    "updatedAt = :updatedAt",
    "#version = #version + :one",
    "#status = :status",
    "#searchName = :searchName",
    "#searchField = :searchField"
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
