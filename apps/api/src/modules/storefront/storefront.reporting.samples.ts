import type { StorefrontOrderRecord } from "./storefront.repository.js";

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

export function buildSampleWeeklyRevenueSummary(referenceDate = new Date()): WeeklyRevenueSummary {
  const rangeEndDate = new Date(referenceDate);
  const rangeStartDate = new Date(referenceDate);
  rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - 7);

  const orders: StorefrontOrderRecord[] = [
    {
      PK: "ORDER#sample-1",
      SK: "DETAIL",
      entityType: "ORDER",
      id: "SM-20260817-001",
      customerEmail: "khach1@example.com",
      status: "done",
      items: [
        { productId: "p-iphone-16", productName: "iPhone 16 Pro 256GB", price: 32990000, quantity: 1, lineTotal: 32990000 },
        { productId: "p-airpods-pro", productName: "AirPods Pro 2", price: 5990000, quantity: 1, lineTotal: 5990000 }
      ],
      totalAmount: 38980000,
      createdAt: new Date(rangeEndDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(rangeEndDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      PK: "ORDER#sample-2",
      SK: "DETAIL",
      entityType: "ORDER",
      id: "SM-20260817-002",
      customerEmail: "khach2@example.com",
      status: "done",
      items: [
        { productId: "p-macbook-air", productName: "MacBook Air M4", price: 28990000, quantity: 1, lineTotal: 28990000 }
      ],
      totalAmount: 28990000,
      createdAt: new Date(rangeEndDate.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(rangeEndDate.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      PK: "ORDER#sample-3",
      SK: "DETAIL",
      entityType: "ORDER",
      id: "SM-20260817-003",
      customerEmail: "khach3@example.com",
      status: "done",
      items: [
        { productId: "p-airpods-pro", productName: "AirPods Pro 2", price: 5990000, quantity: 2, lineTotal: 11980000 },
        { productId: "p-ipad-air", productName: "iPad Air 11 inch", price: 18990000, quantity: 1, lineTotal: 18990000 }
      ],
      totalAmount: 30970000,
      createdAt: new Date(rangeEndDate.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(rangeEndDate.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  const topProducts = [
    { productId: "p-iphone-16", productName: "iPhone 16 Pro 256GB", quantity: 1, revenue: 32990000 },
    { productId: "p-macbook-air", productName: "MacBook Air M4", quantity: 1, revenue: 28990000 },
    { productId: "p-ipad-air", productName: "iPad Air 11 inch", quantity: 1, revenue: 18990000 },
    { productId: "p-airpods-pro", productName: "AirPods Pro 2", quantity: 3, revenue: 17970000 }
  ].sort((left, right) => right.revenue - left.revenue);

  const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);

  return {
    generatedAt: referenceDate.toISOString(),
    rangeStart: rangeStartDate.toISOString(),
    rangeEnd: rangeEndDate.toISOString(),
    currency: "VND",
    orderCount: orders.length,
    totalRevenue,
    averageOrderValue: totalRevenue / orders.length,
    topProducts,
    orders
  };
}
