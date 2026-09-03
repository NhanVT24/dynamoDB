import crypto from "node:crypto";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { keys } from "../../database/dynamodb/keys.js";
import { getMockShoppingItem, listMockShoppingItems } from "./shopping.mock.js";

const TableName = env.DYNAMODB_TABLE_NAME;
const INCREMENTABLE_FIELDS = new Set(["stock", "soldCount"]);

type DynamoKey = Record<string, AttributeValue>;
type ProductRecord = Record<string, any>;
type ProductInput = ProductRecord & {
  id?: string;
  name?: string;
  updatedAt?: string;
  createdAt?: string;
  searchField?: string;
  searchName?: string;
  originalPrice?: number;
  stock?: number;
  status?: string;
  version?: number;
};
type ShoppingFilters = {
  category?: string;
  status?: string;
  updatedAtFrom?: string;
  searchField?: "name" | "brand";
  search?: string;
  sortBy?: "price" | "stock" | "updatedAt";
  sortDirection?: "asc" | "desc";
};

export type InventoryReportProduct = Pick<ProductRecord,
  "id" | "name" | "sku" | "stock" | "status" | "updatedAt" | "inventoryAlertSent"
>;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/Ä‘/g, "d");
}

function deriveStatus(stock: number) {
  if (stock <= 0) return "out_of_stock";
  if (stock <= 10) return "low_stock";
  return "active";
}

function toProductRecord(input: ProductInput, current: ProductRecord | null): ProductInput {
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

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? (unmarshall(item) as ProductRecord) : null;
}

function isProductItem(item: ProductRecord | null) {
  if (!item) return false;
  if (item.entityType === "PRODUCT") return true;
  return String(item.PK ?? "").startsWith("PRODUCT#") && String(item.SK ?? "") === "DETAIL";
}

function encodeCursor(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, any>;
}

function matchesFilters(item: ProductRecord | null, filters: ShoppingFilters = {}) {
  if (!isProductItem(item)) return false;
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

function sortItems(items: ProductRecord[], filters: ShoppingFilters = {}) {
  if (!filters.sortBy) {
    return [...items].sort((left, right) =>
      String(right?.updatedAt ?? right?.createdAt ?? "").localeCompare(
        String(left?.updatedAt ?? left?.createdAt ?? "")
      )
    );
  }

  const direction = filters.sortDirection === "asc" ? 1 : -1;
  const field = filters.sortBy;

  if (field === "updatedAt") {
    return [...items].sort((left, right) => {
      const leftValue = String(left?.updatedAt ?? left?.createdAt ?? "");
      const rightValue = String(right?.updatedAt ?? right?.createdAt ?? "");

      if (leftValue === rightValue) {
        return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
      }

      return leftValue.localeCompare(rightValue) * direction;
    });
  }

  return [...items].sort((left, right) => {
    const leftValue = Number(left?.[field] ?? 0);
    const rightValue = Number(right?.[field] ?? 0);

    if (leftValue === rightValue) {
      return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
    }

    return (leftValue - rightValue) * direction;
  });
}

async function listShoppingItemsBase(limit = 12, cursor?: string, filters: ShoppingFilters = {}) {
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
  } catch (error: any) {
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

async function scanUntilEnough(limit: number, cursor?: string, filters: ShoppingFilters = {}) {
  const results: ProductRecord[] = [];
  let state = cursor ? decodeCursor(cursor) : { lastKey: null as DynamoKey | null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey ? encodeCursor({ lastKey: state.lastKey }) : null
      };
    }

    const result = await rawDb.send(new ScanCommand({
      TableName,
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    for (const rawItem of result.Items ?? []) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item as ProductRecord);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = { lastKey: result.LastEvaluatedKey ?? null };

    if (!result.LastEvaluatedKey) {
      return { items: results, nextCursor: null };
    }
  }

  return { items: results, nextCursor: null };
}

async function scanBrandSearchUntilEnough(limit: number, cursor?: string, filters: ShoppingFilters = {}) {
  const results: ProductRecord[] = [];
  let state = cursor ? decodeCursor(cursor) : { lastKey: null as DynamoKey | null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey ? encodeCursor({ lastKey: state.lastKey }) : null
      };
    }

    const result = await rawDb.send(new ScanCommand({
      TableName,
      FilterExpression: "contains(#brand, :brandValue)",
      ExpressionAttributeNames: { "#brand": "brand" },
      ExpressionAttributeValues: toDynamoItem({
        ":brandValue": String(filters.search ?? "").trim()
      }),
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    for (const rawItem of result.Items ?? []) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item as ProductRecord);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = { lastKey: result.LastEvaluatedKey ?? null };

    if (!result.LastEvaluatedKey) {
      return { items: results, nextCursor: null };
    }
  }

  return { items: results, nextCursor: null };
}

async function queryStatusUpdatedAtWithSearchFilterUntilEnough(limit: number, cursor?: string, filters: ShoppingFilters = {}) {
  if (!filters.status) {
    if ((filters.searchField ?? "name") === "brand" && filters.search) {
      return scanBrandSearchUntilEnough(limit, cursor, filters);
    }
    if (filters.search) {
      return querySearchUntilEnough(limit, cursor, filters);
    }
    return scanUntilEnough(limit, cursor, filters);
  }

  const results: ProductRecord[] = [];
  const search = filters.search ? normalizeText(filters.search) : null;
  let state = cursor ? decodeCursor(cursor) : { lastKey: null as DynamoKey | null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey ? encodeCursor({ lastKey: state.lastKey }) : null
      };
    }

    const result = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "StatusTimelineIndex",
      KeyConditionExpression: "#status = :statusKey AND #updatedAt >= :updatedAtFrom",
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

    for (const rawItem of result.Items ?? []) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item as ProductRecord);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = { lastKey: result.LastEvaluatedKey ?? null };

    if (!result.LastEvaluatedKey) {
      return { items: results, nextCursor: null };
    }
  }

  return { items: results, nextCursor: null };
}

function buildCategoryStatusNameQuery(filters: ShoppingFilters = {}) {
  const search = filters.search ? normalizeText(filters.search) : null;
  const expressionParts = ["category = :categoryKey"];
  const values: Record<string, unknown> = { ":categoryKey": filters.category };
  const names: Record<string, string> = {};

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

async function queryCategoryStatusNameUntilEnough(limit: number, cursor?: string, filters: ShoppingFilters = {}) {
  const results: ProductRecord[] = [];
  const queryInput = buildCategoryStatusNameQuery(filters);
  let state = cursor ? decodeCursor(cursor) : { lastKey: null as DynamoKey | null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey ? encodeCursor({ lastKey: state.lastKey }) : null
      };
    }

    const result = await rawDb.send(new QueryCommand({
      TableName,
      IndexName: "CategoryStatusNameIndex",
      ...queryInput,
      Limit: missingItems,
      ExclusiveStartKey: state.lastKey ?? undefined
    }));

    for (const rawItem of result.Items ?? []) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item as ProductRecord);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = { lastKey: result.LastEvaluatedKey ?? null };

    if (!result.LastEvaluatedKey) {
      return { items: results, nextCursor: null };
    }
  }

  return { items: results, nextCursor: null };
}

async function querySearchUntilEnough(limit: number, cursor?: string, filters: ShoppingFilters = {}) {
  if ((filters.searchField ?? "name") === "brand") {
    return scanBrandSearchUntilEnough(limit, cursor, filters);
  }

  const results: ProductRecord[] = [];
  const search = normalizeText(filters.search);
  let state = cursor ? decodeCursor(cursor) : { lastKey: null as DynamoKey | null };

  while (results.length < limit) {
    const missingItems = Math.max(0, limit - results.length);
    if (missingItems === 0) {
      return {
        items: results,
        nextCursor: state.lastKey ? encodeCursor({ lastKey: state.lastKey }) : null
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

    for (const rawItem of result.Items ?? []) {
      const item = fromDynamoItem(rawItem);
      if (!matchesFilters(item, filters)) continue;

      results.push(item as ProductRecord);
      if (results.length === limit) {
        return {
          items: results,
          nextCursor: result.LastEvaluatedKey
            ? encodeCursor({ lastKey: result.LastEvaluatedKey })
            : null
        };
      }
    }

    state = { lastKey: result.LastEvaluatedKey ?? null };

    if (!result.LastEvaluatedKey) {
      return { items: results, nextCursor: null };
    }
  }

  return { items: results, nextCursor: null };
}

export async function createShoppingItem(input: ProductRecord) {
  const now = new Date().toISOString();
  const item = toProductRecord(
    {
      ...input,
      id: crypto.randomUUID(),
      entityType: "PRODUCT",
      searchName: normalizeText(input.name),
      // A new low-stock product has not been included in an inventory alert yet.
      inventoryAlertSent: false,
      version: 1,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    },
    null
  );

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem({ ...keys.product(item.id), ...item }),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return item;
}

export async function getShoppingItem(id: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConsistentRead: true
  }));

  return fromDynamoItem(result.Item);
}

export async function incrementItemValue(id: string, field: string, incrementBy = 1) {
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
      "#version = #version + :one",
      ...(field === "stock" ? ["#inventoryAlertSent = :inventoryAlertSent"] : [])
    ].join(", ") + (field === "stock" ? " REMOVE inventoryAlertSentAt" : ""),
    // Stock decrements must leave enough physical units for active checkout holds.
    ConditionExpression: field === "stock"
      ? "attribute_exists(PK) AND (attribute_not_exists(#reservedStock) OR #reservedStock <= :fieldValue)"
      : "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#field": field,
      "#status": "status",
      "#searchName": "searchName",
      "#version": "version",
      "#reservedStock": "reservedStock",
      "#inventoryAlertSent": "inventoryAlertSent"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":fieldValue": nextValue,
      ":status": nextRecord.status,
      ":searchName": nextRecord.searchName,
      ":updatedAt": nextRecord.updatedAt,
      ":one": 1,
      ...(field === "stock" ? { ":inventoryAlertSent": false } : {})
    }),
    ReturnValues: "ALL_NEW"
  }));

  return fromDynamoItem(result.Attributes);
}

export async function listShoppingItems(limit = 12, cursor?: string, filters: ShoppingFilters = {}) {
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
      nextCursor: nextOffset < sorted.length ? encodeCursor({ offset: nextOffset }) : null,
      hasNextPage: nextOffset < sorted.length
    };
  }

  const baseResult = await listShoppingItemsBase(limit, cursor, filters);
  if (!cursor) {
    return { ...baseResult, items: sortItems(baseResult.items, {}) };
  }

  return baseResult;
}

export async function getCursorForPage(page = 1, limit = 12, filters: ShoppingFilters = {}) {
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
  let currentCursor: string | null = null;
  let currentPage = 1;
  let result = await listShoppingItems(pageSize, currentCursor ?? undefined, filters);

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

export async function getShoppingItemAll(pageLimit = 50, maxPages = 20, filters: ShoppingFilters = {}) {
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
  return { ...base, items: sortItems(base.items, {}) };
}

export async function listInventoryReportProducts(): Promise<InventoryReportProduct[]> {
  const products: InventoryReportProduct[] = [];

  // Each status has its own partition in StatusTimelineIndex, so this avoids a table Scan.
  for (const status of ["out_of_stock", "low_stock"] as const) {
    let lastKey: DynamoKey | undefined;

    do {
      const result = await rawDb.send(new QueryCommand({
        TableName,
        IndexName: "StatusTimelineIndex",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: toDynamoItem({
          ":status": status
        }),
        ScanIndexForward: true,
        ExclusiveStartKey: lastKey
      }));

      products.push(...(result.Items ?? [])
        .map((item) => fromDynamoItem(item))
        .filter(isProductItem)
        .filter((item) => item?.inventoryAlertSent !== true)
        .map((item) => ({
          id: String(item?.id ?? ""),
          name: String(item?.name ?? ""),
          sku: item?.sku ? String(item.sku) : undefined,
          stock: Number(item?.stock ?? 0),
          status: String(item?.status ?? status),
          updatedAt: String(item?.updatedAt ?? item?.createdAt ?? ""),
          inventoryAlertSent: item?.inventoryAlertSent === true
        })));

      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
  }

  return products;
}

export async function markInventoryReportProductsAlerted(products: InventoryReportProduct[]) {
  let markedCount = 0;

  for (const product of products) {
    try {
      await rawDb.send(new UpdateItemCommand({
        TableName,
        Key: toDynamoItem(keys.product(product.id)),
        // Do not mark a product as alerted if its inventory changed after the
        // digest snapshot was created. It must remain eligible for the next run.
        ConditionExpression: "attribute_exists(PK) AND #stock = :stock AND #status = :status AND (attribute_not_exists(#inventoryAlertSent) OR #inventoryAlertSent = :false)",
        UpdateExpression: "SET #inventoryAlertSent = :true, inventoryAlertSentAt = :alertedAt",
        ExpressionAttributeNames: {
          "#stock": "stock",
          "#status": "status",
          "#inventoryAlertSent": "inventoryAlertSent"
        },
        ExpressionAttributeValues: toDynamoItem({
          ":stock": product.stock,
          ":status": product.status,
          ":false": false,
          ":true": true,
          ":alertedAt": new Date().toISOString()
        })
      }));
      markedCount += 1;
    } catch (error) {
      if ((error as { name?: string }).name !== "ConditionalCheckFailedException") {
        throw error;
      }
    }
  }

  return markedCount;
}

async function getShoppingItemAllBase(pageLimit = 50, maxPages = 20, filters: ShoppingFilters = {}) {
  const allItems: ProductRecord[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    const result = await listShoppingItemsBase(pageLimit, cursor, filters);
    allItems.push(...result.items);
    cursor = result.nextCursor ?? undefined;
    page += 1;
  } while (cursor && page < maxPages);

  return {
    items: allItems,
    nextCursor: cursor ?? null,
    stoppedByMaxPages: Boolean(cursor)
  };
}

export async function updateShoppingItem(id: string, patch: ProductRecord, version: number) {
  const current = await getShoppingItem(id);
  if (!current) {
    const error = new Error("Product not found");
    error.name = "ConditionalCheckFailedException";
    throw error;
  }

  const merged = toProductRecord(
    { ...patch, updatedAt: new Date().toISOString() },
    current
  );
  const names: Record<string, string> = {
    "#version": "version",
    "#status": "status",
    "#searchName": "searchName",
    "#searchField": "searchField",
    "#reservedStock": "reservedStock"
  };
  const values: Record<string, unknown> = {
    ":expectedVersion": version,
    ":one": 1,
    ":updatedAt": merged.updatedAt,
    ":status": merged.status,
    ":searchName": normalizeText(merged.name),
    ":searchField": merged.searchField ?? "name",
    ":resultingStock": Number(merged.stock ?? 0)
  };
  const setters = [
    "updatedAt = :updatedAt",
    "#version = #version + :one",
    "#status = :status",
    "#searchName = :searchName",
    "#searchField = :searchField"
  ];
  const stockChanged = Object.hasOwn(patch, "stock") && Number(merged.stock ?? 0) !== Number(current.stock ?? 0);

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

  if (stockChanged) {
    names["#inventoryAlertSent"] = "inventoryAlertSent";
    values[":inventoryAlertSent"] = false;
    setters.push("#inventoryAlertSent = :inventoryAlertSent");
  }

  const result = await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    UpdateExpression: `SET ${setters.join(", ")}${stockChanged ? " REMOVE inventoryAlertSentAt" : ""}`,
    // This is evaluated atomically with the update, including reservations made
    // after the admin read the product but before this write.
    ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion AND (attribute_not_exists(#reservedStock) OR #reservedStock <= :resultingStock)",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: toDynamoItem(values),
    ReturnValues: "ALL_NEW"
  }));

  return fromDynamoItem(result.Attributes);
}

export async function deleteShoppingItem(id: string) {
  await rawDb.send(new DeleteItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConditionExpression: "attribute_exists(PK)"
  }));
}
