import type { BuildWeeklyRevenue } from "./weekly-revenue.js";
export type WeeklyRevenueSummary = Awaited<ReturnType<BuildWeeklyRevenue["execute"]>>;
export interface RevenueReportDelivery {
    send(summary: WeeklyRevenueSummary): Promise<unknown>;
}
/** Delivery is separate from generation so scheduled and workflow callers share it.
 * No automatic retry here: a lost provider response may already have sent email.
 */
export class DeliverWeeklyRevenue {
    constructor(private readonly delivery: RevenueReportDelivery) { }
    async execute(summary: WeeklyRevenueSummary) {
        await this.delivery.send(summary);
        return { sent: true as const, mailType: "weekly-revenue-report" as const };
    }
}
