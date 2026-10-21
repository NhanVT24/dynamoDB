export interface RevenueLine {
    productId: string;
    productName: string;
    quantity: number;
    lineTotal: number;
}
export interface RevenueOrder {
    id: string;
    customerEmail: string;
    status: string;
    createdAt: string;
    totalAmount: number;
    items: RevenueLine[];
}
export interface RevenueReader {
    list(): Promise<RevenueOrder[]>;
}
function isDateWithinRange(value: string, fromInclusive: number, toExclusive: number) {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return false;
    }
    return timestamp >= fromInclusive && timestamp < toExclusive;
}
export class BuildWeeklyRevenue {
    constructor(private readonly reader: RevenueReader) { }
    async execute(referenceDate = new Date()) {
        const rangeEndDate = new Date(referenceDate), rangeStartDate = new Date(referenceDate);
        rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - 7);
        const orders = (await this.reader.list()).filter(order => ["paid", "done", "pending"].includes(order.status) &&
            isDateWithinRange(order.createdAt, rangeStartDate.getTime(), rangeEndDate.getTime()))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const topProductsMap = new Map<string, {
            productId: string;
            productName: string;
            quantity: number;
            revenue: number;
        }>();
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
            currency: "VND" as const,
            orderCount,
            totalRevenue,
            averageOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
            topProducts: Array.from(topProductsMap.values())
                .sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity)
                .slice(0, 5),
            orders
        };
    }
}
