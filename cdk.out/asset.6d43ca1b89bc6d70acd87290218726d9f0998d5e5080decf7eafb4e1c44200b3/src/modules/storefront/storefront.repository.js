import crypto from "node:crypto";
import { PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import { getShoppingItem, incrementItemValue, listShoppingItems } from "../shopping/shopping.repository.js";
const TableName = env.DYNAMODB_TABLE_NAME;
function toDynamoItem(item) {
    return marshall(item, { removeUndefinedValues: true });
}
function fromDynamoItem(item) {
    return item ? unmarshall(item) : null;
}
export async function listStorefrontProducts(query) {
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
export async function getStorefrontProductById(id) {
    return getShoppingItem(id);
}
export async function createStorefrontOrder(input) {
    const lines = [];
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
export async function listOrdersByCustomer(email) {
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
