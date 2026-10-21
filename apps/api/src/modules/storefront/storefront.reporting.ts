import { DeliverWeeklyRevenue } from "./application/deliver-weekly-revenue.js";
import { sendWeeklyRevenueReportEmail } from "../../integrations/ses/admin-report-mailer.js";
import { BuildWeeklyRevenue } from "./application/weekly-revenue.js";
import { DynamoRevenueReader } from "./infrastructure/persistence/dynamo-revenue-reader.js";
const query = new BuildWeeklyRevenue(new DynamoRevenueReader());
export function buildWeeklyRevenueSummary(referenceDate = new Date()) { return query.execute(referenceDate); }

export const weeklyRevenueDelivery = new DeliverWeeklyRevenue({ send: sendWeeklyRevenueReportEmail });
