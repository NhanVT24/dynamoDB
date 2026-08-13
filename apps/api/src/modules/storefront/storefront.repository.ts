import crypto from "node:crypto";
import { DeleteItemCommand, GetItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
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

export type StorefrontOrderQueuePayload = {
  type: "storefront.order.requested";
  requestId: string;
  email: string;
  items: Array<{ productId: string; quantity: number }>;
  createdAt: string;
};

export type ProductSelectionLock = {
  productId: string;
  customerEmail: string;
  requestId: string;
  lockedUntil: string;
};

export type StorefrontOrderRecord = {
  PK: string;
  SK: string;
  entityType: "ORDER";
  id: string;
  customerEmail: string;
  status: "pending" | "done";
  items: OrderLine[];
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
};

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? (unmarshall(item) as Record<string, any>) : null;
}

function buildProductLockKey(productId: string) {
  return {
    PK: `PRODUCT_LOCK#${productId}`,
    SK: "RESERVATION"
  };
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
  const orderRecord: StorefrontOrderRecord = {
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

export async function acquireProductSelectionLock(input: { productId: string; email: string; requestId: string; holdSeconds: number }) {
  const now = Date.now();
  const lockUntil = new Date(now + input.holdSeconds * 1000).toISOString();
  const ttl = Math.floor((now + input.holdSeconds * 1000) / 1000);

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem({
      ...buildProductLockKey(input.productId),
      entityType: "PRODUCT_SELECTION_LOCK",
      productId: input.productId,
      customerEmail: input.email,
      requestId: input.requestId,
      lockedUntil: lockUntil,
      ttl,
      createdAt: new Date(now).toISOString()
    }),
    ConditionExpression: "attribute_not_exists(PK) OR lockedUntil < :now",
    ExpressionAttributeValues: toDynamoItem({
      ":now": new Date(now).toISOString()
    })
  }));

  return {
    productId: input.productId,
    customerEmail: input.email,
    requestId: input.requestId,
    lockedUntil: lockUntil
  } satisfies ProductSelectionLock;
}

export async function releaseProductSelectionLock(productId: string, requestId?: string) {
  const deleteInput = {
    TableName,
    Key: toDynamoItem(buildProductLockKey(productId))
  } as const;

  if (!requestId) {
    await rawDb.send(new DeleteItemCommand(deleteInput));
    return;
  }

  await rawDb.send(new DeleteItemCommand({
    ...deleteInput,
    ConditionExpression: "requestId = :requestId",
    ExpressionAttributeValues: toDynamoItem({
      ":requestId": requestId
    })
  }));
}

export async function getActiveProductSelectionLock(productId: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(buildProductLockKey(productId))
  }));

  const item = fromDynamoItem(result.Item);
  if (!item) {
    return null;
  }

  const lockedUntil = String(item.lockedUntil ?? "");
  if (!lockedUntil || Date.parse(lockedUntil) <= Date.now()) {
    return null;
  }

  return {
    productId: String(item.productId ?? productId),
    customerEmail: String(item.customerEmail ?? ""),
    requestId: String(item.requestId ?? ""),
    lockedUntil
  } satisfies ProductSelectionLock;
}

export async function getOrderById(id: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `ORDER#${id}`,
      SK: "DETAIL"
    })
  }));

  return fromDynamoItem(result.Item) as StorefrontOrderRecord | null;
}

export async function markOrderAsDone(id: string) {
  const now = new Date().toISOString();

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem({
      PK: `ORDER#${id}`,
      SK: `DETAIL#STATUS_CHANGE#${now}`,
      entityType: "ORDER_STATUS_AUDIT",
      orderId: id,
      status: "done",
      createdAt: now
    })
  }));

  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `ORDER#${id}`,
      SK: "DETAIL"
    }),
    UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":status": "done",
      ":updatedAt": now
    })
  }));
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
    .filter(Boolean)
    .sort((left, right) => String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")));
}
