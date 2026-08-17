import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";
import type { StorefrontOrderRecord } from "./storefront.repository.js";

const TableName = env.DYNAMODB_TABLE_NAME;

type WeeklyRevenueSummary = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  currency: "VND";
  orderCount: number;
  totalRevenue: number;
  averageOrderValue: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
  orders: StorefrontOrderRecord[];
};

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

function isDateWithinRange(value: string, fromInclusive: number, toExclusive: number) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= fromInclusive && timestamp < toExclusive;
}

export async function buildWeeklyRevenueSummary(referenceDate = new Date()): Promise<WeeklyRevenueSummary> {
  const rangeEndDate = new Date(referenceDate);
  const rangeStartDate = new Date(referenceDate);
  rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - 7);

  const rangeStartTime = rangeStartDate.getTime();
  const rangeEndTime = rangeEndDate.getTime();

  const result = await rawDb.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :entityType AND #status = :status",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":entityType": "ORDER",
      ":status": "done"
    })
  }));

  const orders = (result.Items ?? [])
    .map((item) => unmarshall(item) as StorefrontOrderRecord)
    .filter((item) => isDateWithinRange(String(item.createdAt ?? ""), rangeStartTime, rangeEndTime))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

  const topProductsMap = new Map<string, { productId: string; productName: string; quantity: number; revenue: number }>();
  let totalRevenue = 0;

  for (const order of orders) {
    totalRevenue += Number(order.totalAmount ?? 0);

    for (const item of order.items ?? []) {
      const existing = topProductsMap.get(item.productId) ?? {
        productId: item.productId,
        productName: item.productName,
        quantity: 0,
        revenue: 0
      };

      existing.quantity += Number(item.quantity ?? 0);
      existing.revenue += Number(item.lineTotal ?? 0);
      topProductsMap.set(item.productId, existing);
    }
  }

  const orderCount = orders.length;

  return {
    generatedAt: referenceDate.toISOString(),
    rangeStart: rangeStartDate.toISOString(),
    rangeEnd: rangeEndDate.toISOString(),
    currency: "VND",
    orderCount,
    totalRevenue,
    averageOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
    topProducts: Array.from(topProductsMap.values())
      .sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity)
      .slice(0, 5),
    orders
  };
}
