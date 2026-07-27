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

const TableName = env.DYNAMODB_TABLE_NAME;
const INCREMENTABLE_FIELDS = new Set(["stock", "soldCount"]);

/** Mã hóa LastEvaluatedKey để frontend dùng như cursor phân trang. */
function encodeCursor(key) {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/** Giải mã cursor từ frontend về đúng dạng key raw của DynamoDB. */
function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

/** Chuẩn hóa text để tạo khóa phụ và tìm kiếm không phân biệt hoa thường. */
function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

/** Tự suy ra trạng thái bán hàng dựa trên số lượng tồn kho. */
function deriveStatus(stock) {
  if (stock <= 0) return "out_of_stock";
  if (stock <= 10) return "low_stock";
  return "active";
}

/** Tạo khóa GSI1 để query sản phẩm theo danh mục và sắp theo trạng thái/tên. */
function buildIndexes(product) {
  return {
    GSI1PK: `CATEGORY#${normalizeText(product.category)}`,
    GSI1SK: `STATUS#${product.status}#NAME#${normalizeText(product.name)}#PRODUCT#${product.id}`
  };
}

/** Gộp dữ liệu mới với bản ghi hiện tại và bổ sung field suy luận. */
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

/** Chuyển object JavaScript sang AttributeValue map của raw DynamoDB. */
function toDynamoItem(item) {
  return marshall(item, { removeUndefinedValues: true });
}

/** Chuyển AttributeValue map của raw DynamoDB về object JavaScript. */
function fromDynamoItem(item) {
  return item ? unmarshall(item) : null;
}

/** Tạo sản phẩm mới bằng PutItemCommand raw, kèm condition tránh ghi đè. */
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

/** Đọc chi tiết một sản phẩm bằng GetItemCommand raw theo PK/SK. */
export async function getShoppingItem(id) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConsistentRead: true
  }));

  return fromDynamoItem(result.Item);
}

/** Tăng hoặc giảm tồn kho/lượt bán bằng UpdateItemCommand raw. */
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

/** Query sản phẩm theo danh mục bằng GSI1, sau đó lọc thêm trạng thái/từ khóa. */
async function listByCategory(category, limit, cursor, status, search) {
  const result = await rawDb.send(new QueryCommand({
    TableName,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: toDynamoItem({
      ":pk": `CATEGORY#${normalizeText(category)}`
    }),
    Limit: limit,
    ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined,
    ScanIndexForward: true
  }));

  const filteredItems = (result.Items ?? []).map(fromDynamoItem).filter((item) => {
    const statusMatch = status ? item.status === status : true;
    const searchMatch = search ? normalizeText(item.name).includes(normalizeText(search)) : true;
    return item.entityType === "PRODUCT" && statusMatch && searchMatch;
  });

  return {
    items: filteredItems,
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null
  };
}

/** Scan toàn bộ sản phẩm khi không chọn danh mục cụ thể. */
async function listAll(limit, cursor, status, search) {
  const expressions = ["entityType = :type"];
  const values = { ":type": "PRODUCT" };
  const names = {};

  if (status) {
    expressions.push("#status = :status");
    names["#status"] = "status";
    values[":status"] = status;
  }

  if (search) {
    expressions.push("(contains(#searchName, :search) OR contains(#name, :rawSearch))");
    names["#searchName"] = "searchName";
    names["#name"] = "name";
    values[":search"] = normalizeText(search);
    values[":rawSearch"] = search;
  }

  const result = await rawDb.send(new ScanCommand({
    TableName,
    FilterExpression: expressions.join(" AND "),
    ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
    ExpressionAttributeValues: toDynamoItem(values),
    Limit: limit,
    ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined
  }));

  return {
    items: (result.Items ?? []).map(fromDynamoItem),
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null
  };
}

/** Liệt kê sản phẩm, ưu tiên QueryCommand khi có danh mục để đúng thiết kế GSI. */
export async function listShoppingItems(limit = 12, cursor, filters = {}) {
  const { category, status, search } = filters;

  if (category && category !== "all") {
    return listByCategory(category, limit, cursor, status, search);
  }

  return listAll(limit, cursor, status, search);
}

/** Tải nhiều trang để tính dashboard tổng quan mà vẫn tôn trọng cursor DynamoDB. */
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

/** Phân trang kiểu admin theo số trang sau khi đã áp dụng filter. */
export async function listShoppingItemsByPage(page = 1, limit = 12, filters = {}) {
  const result = await getShoppingItemAll(100, 100, filters);
  const totalItems = result.items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * limit;
  const pageItems = result.items.slice(startIndex, startIndex + limit);

  return {
    items: pageItems,
    page: safePage,
    limit,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
    nextPage: safePage < totalPages ? safePage + 1 : null,
    previousPage: safePage > 1 ? safePage - 1 : null
  };
}

/** Sửa sản phẩm bằng UpdateItemCommand raw và kiểm tra version chống ghi đè. */
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

/** Xóa một sản phẩm bằng DeleteItemCommand raw, có condition tránh xóa nhầm. */
export async function deleteShoppingItem(id) {
  await rawDb.send(new DeleteItemCommand({
    TableName,
    Key: toDynamoItem(keys.product(id)),
    ConditionExpression: "attribute_exists(PK)"
  }));
}
