import "reflect-metadata";
import { weeklyRevenueDelivery } from "../../../modules/storefront/storefront.reporting.js";
import type { WeeklyRevenueSummary } from "../../../modules/storefront/application/deliver-weekly-revenue.js";

type MailWorkflowInput = {
  mailType?: string;
  summary?: WeeklyRevenueSummary;
};

export const handler = async (event: MailWorkflowInput) => {
  if (event.mailType !== "weekly-revenue-report" || !event.summary) {
    throw new Error(`Unsupported workflow mail type: ${event.mailType ?? "unknown"}`);
  }

  await weeklyRevenueDelivery.execute(event.summary);
  return {
    sent: true,
    mailType: event.mailType
  };
};
