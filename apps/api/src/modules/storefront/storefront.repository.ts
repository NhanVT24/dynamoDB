import crypto from "node:crypto";
import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand, TransactWriteItemsCommand, UpdateItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { keys } from "../../database/dynamodb/keys.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { getShoppingItem, listShoppingItems } from "../shopping/shopping.repository.js";

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

export type CheckoutGateQueuePayload = {
  type: "storefront.checkout.gate.requested";
  requestId: string;
  email: string;
  items: Array<{ productId: string; quantity: number }>;
  locale?: "vn" | "en";
  bankCode?: string;
  processingMode?: "interactive" | "trigger";
  createdAt: string;
};

export type InventoryStockChange = {
  productId: string;
  productName: string;
  sku?: string;
  previousStock: number;
  stock: number;
  previousStatus: string;
  status: string;
};

export type CheckoutReservationRecord = {
  PK: string;
  SK: string;
  entityType: "CHECKOUT_RESERVATION";
  requestId: string;
  productId: string;
  customerEmail: string;
  quantity: number;
  unitPrice: number;
  productName: string;
  expiresAt: string;
  status: "reserved" | "released" | "committed";
  productVersionAtReserve: number;
  createdAt: string;
  updatedAt: string;
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

export type StorefrontOrderCreationResult = {
  order: StorefrontOrderRecord;
  stockChanges: InventoryStockChange[];
};

export type CheckoutGateStatus = "pending" | "allowed" | "blocked" | "completed";

export type CheckoutGateRequestRecord = {
  PK: string;
  SK: string;
  entityType: "CHECKOUT_GATE";
  requestId: string;
  customerEmail: string;
  status: CheckoutGateStatus;
  items: Array<{ productId: string; quantity: number }>;
  createdAt: string;
  updatedAt: string;
  message?: string;
  failureCode?: string;
  paymentUrl?: string;
  locale?: "vn" | "en";
  bankCode?: string;
  lockedUntil?: string;
  processingMode?: "interactive" | "trigger";
};

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function fromDynamoItem(item?: Record<string, AttributeValue>) {
  return item ? (unmarshall(item) as Record<string, any>) : null;
}

function buildCheckoutReservationKey(requestId: string, productId: string) {
  return {
    PK: `CHECKOUT_RESERVATION#${requestId}`,
    SK: `PRODUCT#${productId}`
  };
}

function buildCheckoutGateKey(requestId: string) {
  return {
    PK: `CHECKOUT_GATE#${requestId}`,
    SK: "DETAIL"
  };
}

function normalizeOrderItems(items: Array<{ productId?: string; quantity: number }>) {
  const merged = new Map<string, number>();

  for (const item of items) {
    const productId = String(item.productId ?? "").trim().replace(/^PRODUCT#/i, "");
    const quantity = Number(item.quantity ?? 0);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }

  return [...merged.entries()].map(([productId, quantity]): { productId: string; quantity: number } => ({
    productId,
    quantity
  }));
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

export async function createStorefrontOrder(input: CreateOrderPayload): Promise<StorefrontOrderCreationResult> {
  const normalizedItems = normalizeOrderItems(input.items);
  const lines: OrderLine[] = [];
  let totalAmount = 0;
  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const productSnapshots = new Map<string, Record<string, any>>();

  for (const item of normalizedItems) {
    const product = await getShoppingItem(item.productId);
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }

    const availableStock = Number(product.stock ?? 0) - Number(product.reservedStock ?? 0);
    if (availableStock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    const price = Number(product.price ?? 0);
    const lineTotal = price * item.quantity;
    totalAmount += lineTotal;
    productSnapshots.set(item.productId, product);
    lines.push({
      productId: item.productId,
      productName: String(product.name ?? ""),
      price,
      quantity: item.quantity,
      lineTotal
    });
  }
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
  try {
    await rawDb.send(new TransactWriteItemsCommand({
      TransactItems: [
        ...normalizedItems.map((item) => {
          const product = productSnapshots.get(item.productId);
          if (!product) {
            throw new Error(`Product ${item.productId} not found`);
          }

          return {
            Update: {
              TableName,
              Key: toDynamoItem(keys.product(item.productId)),
              UpdateExpression: [
                "SET #stock = #stock - :quantity",
                "#soldCount = if_not_exists(#soldCount, :zero) + :quantity",
                "updatedAt = :updatedAt",
                "#version = if_not_exists(#version, :zero) + :one"
              ].join(", "),
              ConditionExpression: "#stock >= :quantity AND if_not_exists(#reservedStock, :zero) = :zero",
              ExpressionAttributeNames: {
                "#stock": "stock",
                "#soldCount": "soldCount",
                "#version": "version",
                "#reservedStock": "reservedStock"
              },
              ExpressionAttributeValues: toDynamoItem({
                ":updatedAt": now,
                ":quantity": item.quantity,
                ":zero": 0,
                ":one": 1
              })
            }
          };
        }),
        {
          Put: {
            TableName,
            Item: toDynamoItem(orderRecord),
            ConditionExpression: "attribute_not_exists(PK)"
          }
        }
      ]
    }));
  } catch (error) {
    const candidate = error as { name?: string };
    if (candidate?.name === "TransactionCanceledException") {
      for (const item of normalizedItems) {
        const latestProduct = await getShoppingItem(item.productId);
        if (!latestProduct) {
          throw new Error(`Product ${item.productId} not found`);
        }

        if (Number(latestProduct.stock ?? 0) < item.quantity) {
          throw new Error(`Insufficient stock for ${latestProduct.name}`);
        }
      }

      const conflictError = new Error("Product inventory changed during checkout");
      conflictError.name = "ConditionalCheckFailedException";
      throw conflictError;
    }

    throw error;
  }

  const stockChanges: InventoryStockChange[] = [];
  for (const item of normalizedItems) {
    const previousProduct = productSnapshots.get(item.productId);
    const latestProduct = await getShoppingItem(item.productId);
    if (!previousProduct || !latestProduct) {
      throw new Error(`Product ${item.productId} not found`);
    }

    const stock = Number(latestProduct.stock ?? 0);
    const status = stock <= 0 ? "out_of_stock" : stock <= 10 ? "low_stock" : "active";
    const previousStatus = String(previousProduct.status ?? "");

    stockChanges.push({
      productId: item.productId,
      productName: String(previousProduct.name ?? latestProduct.name ?? ""),
      sku: previousProduct.sku ? String(previousProduct.sku) : latestProduct.sku ? String(latestProduct.sku) : undefined,
      previousStock: Number(previousProduct.stock ?? 0),
      stock,
      previousStatus,
      status
    });

    if (String(latestProduct.status ?? "") !== status) {
      await rawDb.send(new UpdateItemCommand({
        TableName,
        Key: toDynamoItem(keys.product(item.productId)),
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: toDynamoItem({
          ":status": status,
          ":updatedAt": new Date().toISOString()
        })
      }));
    }
  }

  return {
    order: orderRecord,
    stockChanges
  };
}

export async function createCheckoutGateRequest(input: {
  requestId: string;
  email: string;
  items: Array<{ productId: string; quantity: number }>;
  locale?: "vn" | "en";
  bankCode?: string;
  processingMode?: "interactive" | "trigger";
}) {
  const now = new Date().toISOString();
  const record: CheckoutGateRequestRecord = {
    ...buildCheckoutGateKey(input.requestId),
    entityType: "CHECKOUT_GATE",
    requestId: input.requestId,
    customerEmail: input.email,
    status: "pending",
    items: input.items,
    locale: input.locale,
    bankCode: input.bankCode,
    processingMode: input.processingMode,
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem(record),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return record;
}

export async function getCheckoutGateRequestById(requestId: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem(buildCheckoutGateKey(requestId))
  }));

  return result.Item ? (unmarshall(result.Item) as CheckoutGateRequestRecord) : null;
}

export async function releaseCheckoutGateReservation(input: {
  requestId: string;
  message: string;
  failureCode?: string;
}) {
  const gate = await getCheckoutGateRequestById(input.requestId);
  if (!gate) {
    return false;
  }

  if (gate.status !== "allowed") {
    return false;
  }

  await releaseReservedInventory(input.requestId);

  await updateCheckoutGateRequestStatus({
    requestId: input.requestId,
    expectedStatus: "allowed",
    status: "blocked",
    message: input.message,
    failureCode: input.failureCode ?? "payment_not_completed"
  });

  return true;
}

export async function updateCheckoutGateRequestStatus(input: {
  requestId: string;
  expectedStatus?: CheckoutGateStatus;
  status: Exclude<CheckoutGateStatus, "pending">;
  message: string;
  failureCode?: string;
  paymentUrl?: string;
  lockedUntil?: string;
}) {
  const now = new Date().toISOString();
  const names: Record<string, string> = {
    "#status": "status"
  };
  const values: Record<string, unknown> = {
    ":status": input.status,
    ":message": input.message,
    ":updatedAt": now
  };
  const segments = [
    "#status = :status",
    "message = :message",
    "updatedAt = :updatedAt",
    "failureCode = :failureCode",
    "paymentUrl = :paymentUrl",
    "lockedUntil = :lockedUntil"
  ];

  values[":failureCode"] = input.failureCode ?? "";
  values[":paymentUrl"] = input.paymentUrl ?? "";
  values[":lockedUntil"] = input.lockedUntil ?? "";

  let conditionExpression = "attribute_exists(PK)";
  if (input.expectedStatus) {
    values[":expectedStatus"] = input.expectedStatus;
    conditionExpression += " AND #status = :expectedStatus";
  }

  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem(buildCheckoutGateKey(input.requestId)),
    ConditionExpression: conditionExpression,
    UpdateExpression: `SET ${segments.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: toDynamoItem(values)
  }));
}

export async function createCheckoutReservations(input: {
  requestId: string;
  email: string;
  items: Array<{ productId: string; quantity: number }>;
  holdSeconds: number;
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.holdSeconds * 1000).toISOString();
  const normalizedItems = normalizeOrderItems(input.items);
  const createdReservations: CheckoutReservationRecord[] = [];

  try {
    for (const item of normalizedItems) {
      let reserved = false;

      for (let attempt = 0; attempt < 3 && !reserved; attempt += 1) {
        const product = await getShoppingItem(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }

        const stock = Number(product.stock ?? 0);
        const reservedStock = Number(product.reservedStock ?? 0);
        const availableStock = stock - reservedStock;
        if (availableStock < item.quantity) {
          throw new Error(`Insufficient reserved availability for ${product.name}`);
        }

        const reservationRecord: CheckoutReservationRecord = {
          ...buildCheckoutReservationKey(input.requestId, item.productId),
          entityType: "CHECKOUT_RESERVATION",
          requestId: input.requestId,
          productId: item.productId,
          customerEmail: input.email,
          quantity: item.quantity,
          unitPrice: Number(product.price ?? 0),
          productName: String(product.name ?? ""),
          expiresAt,
          status: "reserved",
          productVersionAtReserve: Number(product.version ?? 0),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };

        try {
          await rawDb.send(new TransactWriteItemsCommand({
            TransactItems: [
              {
                Update: {
                  TableName,
                  Key: toDynamoItem(keys.product(item.productId)),
                  ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion AND #stock >= :requiredStock",
                  UpdateExpression: "SET #reservedStock = if_not_exists(#reservedStock, :zero) + :quantity, updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :one",
                  ExpressionAttributeNames: {
                    "#reservedStock": "reservedStock",
                    "#stock": "stock",
                    "#version": "version"
                  },
                  ExpressionAttributeValues: toDynamoItem({
                    ":expectedVersion": Number(product.version ?? 0),
                    ":requiredStock": reservedStock + item.quantity,
                    ":quantity": item.quantity,
                    ":updatedAt": now.toISOString(),
                    ":zero": 0,
                    ":one": 1
                  })
                }
              },
              {
                Put: {
                  TableName,
                  Item: toDynamoItem(reservationRecord),
                  ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                }
              }
            ]
          }));

          createdReservations.push(reservationRecord);
          reserved = true;
        } catch (error) {
          const candidate = error as { name?: string };
          if (candidate?.name === "TransactionCanceledException") {
            continue;
          }
          throw error;
        }
      }

      if (!reserved) {
        throw new Error(`Reservation conflict for ${item.productId}`);
      }
    }
  } catch (error) {
    await releaseReservedInventory(input.requestId);
    throw error;
  }

  return {
    requestId: input.requestId,
    expiresAt,
    reservations: createdReservations
  };
}

export async function listCheckoutReservationsByRequestId(requestId: string) {
  const result = await rawDb.send(new QueryCommand({
    TableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: toDynamoItem({
      ":pk": `CHECKOUT_RESERVATION#${requestId}`
    })
  }));

  return (result.Items ?? [])
    .map((item) => fromDynamoItem(item) as CheckoutReservationRecord | null)
    .filter(Boolean) as CheckoutReservationRecord[];
}

export async function releaseReservedInventory(requestId: string) {
  const reservations = await listCheckoutReservationsByRequestId(requestId);
  const activeReservations = reservations.filter((item) => item.status === "reserved");

  for (const reservation of activeReservations) {
    await rawDb.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName,
            Key: toDynamoItem(keys.product(reservation.productId)),
            ConditionExpression: "attribute_exists(PK) AND if_not_exists(#reservedStock, :zero) >= :quantity",
            UpdateExpression: "SET #reservedStock = if_not_exists(#reservedStock, :zero) - :quantity, updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :one",
            ExpressionAttributeNames: {
              "#reservedStock": "reservedStock",
              "#version": "version"
            },
            ExpressionAttributeValues: toDynamoItem({
              ":quantity": reservation.quantity,
              ":updatedAt": new Date().toISOString(),
              ":zero": 0,
              ":one": 1
            })
          }
        },
        {
          Update: {
            TableName,
            Key: toDynamoItem(buildCheckoutReservationKey(requestId, reservation.productId)),
            ConditionExpression: "attribute_exists(PK) AND #status = :reservedStatus",
            UpdateExpression: "SET #status = :releasedStatus, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: toDynamoItem({
              ":reservedStatus": "reserved",
              ":releasedStatus": "released",
              ":updatedAt": new Date().toISOString()
            })
          }
        }
      ]
    }));
  }

  return activeReservations.length;
}

export async function commitCheckoutReservationsToOrder(input: {
  requestId: string;
  expectedCustomerEmail?: string;
}) {
  const gate = await getCheckoutGateRequestById(input.requestId);
  if (!gate) {
    throw new Error("Checkout request not found");
  }

  if (input.expectedCustomerEmail && gate.customerEmail !== input.expectedCustomerEmail) {
    throw new Error("Checkout request customer does not match");
  }

  if (gate.status === "completed") {
    const existingOrderId = String((gate as Record<string, unknown>).orderId ?? "").trim();
    return {
      orderId: existingOrderId,
      order: existingOrderId ? await getOrderById(existingOrderId) : null,
      stockChanges: [] as InventoryStockChange[]
    };
  }

  if (gate.status !== "allowed") {
    throw new Error("Checkout request is not reserved for payment");
  }

  const reservations = (await listCheckoutReservationsByRequestId(input.requestId)).filter((item) => item.status === "reserved");
  if (reservations.length === 0) {
    throw new Error("Checkout reservation is empty");
  }

  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const orderItems = reservations.map((reservation) => ({
    productId: reservation.productId,
    productName: reservation.productName,
    price: reservation.unitPrice,
    quantity: reservation.quantity,
    lineTotal: reservation.unitPrice * reservation.quantity
  }));
  const totalAmount = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const orderRecord: StorefrontOrderRecord = {
    PK: `ORDER#${orderId}`,
    SK: "DETAIL",
    entityType: "ORDER",
    id: orderId,
    customerEmail: gate.customerEmail,
    status: "pending",
    items: orderItems,
    totalAmount,
    createdAt: now,
    updatedAt: now
  };

  const productSnapshots = new Map<string, Record<string, any>>();
  for (const reservation of reservations) {
    const product = await getShoppingItem(reservation.productId);
    if (!product) {
      throw new Error(`Product ${reservation.productId} not found`);
    }
    productSnapshots.set(reservation.productId, product);
  }

  await rawDb.send(new TransactWriteItemsCommand({
    TransactItems: [
      ...reservations.map((reservation) => ({
        Update: {
          TableName,
          Key: toDynamoItem(keys.product(reservation.productId)),
          ConditionExpression: "attribute_exists(PK) AND #stock >= :quantity AND if_not_exists(#reservedStock, :zero) >= :quantity",
          UpdateExpression: "SET #stock = #stock - :quantity, #reservedStock = if_not_exists(#reservedStock, :zero) - :quantity, #soldCount = if_not_exists(#soldCount, :zero) + :quantity, updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :one",
          ExpressionAttributeNames: {
            "#stock": "stock",
            "#reservedStock": "reservedStock",
            "#soldCount": "soldCount",
            "#version": "version"
          },
          ExpressionAttributeValues: toDynamoItem({
            ":quantity": reservation.quantity,
            ":updatedAt": now,
            ":zero": 0,
            ":one": 1
          })
        }
      })),
      ...reservations.map((reservation) => ({
        Update: {
          TableName,
          Key: toDynamoItem(buildCheckoutReservationKey(input.requestId, reservation.productId)),
          ConditionExpression: "attribute_exists(PK) AND #status = :reservedStatus",
          UpdateExpression: "SET #status = :committedStatus, updatedAt = :updatedAt",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: toDynamoItem({
            ":reservedStatus": "reserved",
            ":committedStatus": "committed",
            ":updatedAt": now
          })
        }
      })),
      {
        Put: {
          TableName,
          Item: toDynamoItem(orderRecord),
          ConditionExpression: "attribute_not_exists(PK)"
        }
      },
      {
        Update: {
          TableName,
          Key: toDynamoItem(buildCheckoutGateKey(input.requestId)),
          ConditionExpression: "attribute_exists(PK) AND #status = :allowedStatus",
          UpdateExpression: "SET #status = :completedStatus, orderId = :orderId, message = :message, updatedAt = :updatedAt",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: toDynamoItem({
            ":allowedStatus": "allowed",
            ":completedStatus": "completed",
            ":orderId": orderId,
            ":message": "Payment confirmed and order committed.",
            ":updatedAt": now
          })
        }
      }
    ]
  }));

  const stockChanges: InventoryStockChange[] = [];
  for (const reservation of reservations) {
    const previousProduct = productSnapshots.get(reservation.productId);
    const latestProduct = await getShoppingItem(reservation.productId);
    if (!previousProduct || !latestProduct) {
      throw new Error(`Product ${reservation.productId} not found`);
    }

    const stock = Number(latestProduct.stock ?? 0);
    const status = stock <= 0 ? "out_of_stock" : stock <= 10 ? "low_stock" : "active";
    stockChanges.push({
      productId: reservation.productId,
      productName: String(reservation.productName ?? previousProduct.name ?? latestProduct.name ?? ""),
      sku: previousProduct.sku ? String(previousProduct.sku) : latestProduct.sku ? String(latestProduct.sku) : undefined,
      previousStock: Number(previousProduct.stock ?? 0),
      stock,
      previousStatus: String(previousProduct.status ?? ""),
      status
    });

    if (String(latestProduct.status ?? "") !== status) {
      await rawDb.send(new UpdateItemCommand({
        TableName,
        Key: toDynamoItem(keys.product(reservation.productId)),
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: toDynamoItem({
          ":status": status,
          ":updatedAt": new Date().toISOString()
        })
      }));
    }
  }

  return {
    orderId,
    order: orderRecord,
    stockChanges
  };
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
