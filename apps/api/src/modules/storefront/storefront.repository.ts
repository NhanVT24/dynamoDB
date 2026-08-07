import crypto from "node:crypto";
import { GetItemCommand, PutItemCommand, ScanCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { getShoppingItem, incrementItemValue, listShoppingItems } from "../shopping/shopping.repository.js";

const TableName = env.DYNAMODB_TABLE_NAME;

type OrderLine = {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  lineTotal: number;
};

type CreateOrderPayload = {
  email: string;
  items: Array<{ productId: string; quantity: number }>;
};

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? (unmarshall(item) as Record<string, any>) : null;
}

export async function listStorefrontProducts(query: Record<string, any>) {
  return listShoppingItems(query.limit, query.cursor, {
    category: query.category,
    status: query.status,
    updatedAtFrom: query.updatedAtFrom,
    searchField: query.searchField,
    search: query.search,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection
  });
}

export async function getStorefrontProductById(id: string) {
  return getShoppingItem(id);
}

export async function createStorefrontOrder(input: CreateOrderPayload) {
  const lines: OrderLine[] = [];
  let totalAmount = 0;

  for (const item of input.items) {
    const product = await getShoppingItem(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }

    if (Number(product.stock ?? 0) < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    const price = Number(product.price ?? 0);
    const lineTotal = price * item.quantity;
    totalAmount += lineTotal;
    lines.push({
      productId: item.productId,
      productName: String(product.name ?? ""),
      price,
      quantity: item.quantity,
      lineTotal
    });
  }

  for (const item of input.items) {
    await incrementItemValue(item.productId, "stock", -item.quantity);
    await incrementItemValue(item.productId, "soldCount", item.quantity);
  }

  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const orderRecord = {
    PK: `ORDER#${orderId}`,
    SK: "DETAIL",
    entityType: "ORDER",
    id: orderId,
    customerEmail: input.email,
    status: "pending",
    items: lines,
    totalAmount,
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem(orderRecord),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return orderRecord;
}

export async function listOrdersByCustomer(email: string) {
  const result = await rawDb.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :entityType AND customerEmail = :customerEmail",
    ExpressionAttributeValues: toDynamoItem({
      ":entityType": "ORDER",
      ":customerEmail": email
    })
  }));

  return (result.Items ?? [])
    .map((item) => fromDynamoItem(item))
    .sort((left, right) => String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")));
}
