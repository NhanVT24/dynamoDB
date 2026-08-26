import "reflect-metadata";
import { sendDailyInventoryReport } from "../../../modules/inventory-reports/inventory-report.service.js";

export const handler = async (event: unknown) => {
  console.log("[lambda-schedule:daily-inventory-report] received", JSON.stringify(event));
  return sendDailyInventoryReport();
};
