import "reflect-metadata";
import { buildWeeklyRevenueSummary } from "../../../modules/storefront/storefront.reporting.js";
import { weeklyRevenueDelivery } from "../../../modules/storefront/storefront.reporting.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-schedule:weekly-admin-report] received", JSON.stringify(event));

  const summary = await buildWeeklyRevenueSummary();
  await weeklyRevenueDelivery.execute(summary);

  return {
    ok: true,
    orderCount: summary.orderCount,
    totalRevenue: summary.totalRevenue,
    reportTo: process.env.ADMIN_REPORT_EMAIL ?? ""
  };
};
