import "reflect-metadata";
import { buildWeeklyRevenueSummary } from "../../modules/storefront/storefront.reporting.js";

export const handler = async () => {
  const summary = await buildWeeklyRevenueSummary();
  return {
    mailType: "weekly-revenue-report",
    summary
  };
};
