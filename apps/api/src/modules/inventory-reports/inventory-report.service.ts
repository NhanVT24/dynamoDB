import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { env } from "../../config/env.js";
import { sendInventoryDigestEmail } from "../../integrations/ses/inventory-report-mailer.js";
import { listInventoryReportProducts } from "../shopping/shopping.repository.js";
import {
  createPendingInventoryReport,
  markInventoryReportAccepted,
  markInventoryReportFailed
} from "./inventory-report.repository.js";

function getVietnamReportDate(referenceDate = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(referenceDate);
}

export async function sendDailyInventoryReport(referenceDate = new Date()) {
  if (!env.ADMIN_REPORT_EMAIL) {
    throw new Error("Missing ADMIN_REPORT_EMAIL configuration.");
  }

  const products = await listInventoryReportProducts();
  if (products.length === 0) {
    return { sent: false, reason: "no_low_or_out_of_stock_products" as const };
  }

  const reportDate = getVietnamReportDate(referenceDate);
  const reportId = `daily-inventory-${reportDate}`;
  const lowStockProducts = products.filter((product) => product.status === "low_stock");
  const outOfStockProducts = products.filter((product) => product.status === "out_of_stock");

  try {
    await createPendingInventoryReport({
      reportId,
      reportDate,
      recipientEmail: env.ADMIN_REPORT_EMAIL,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || (error as { name?: string }).name === "ConditionalCheckFailedException") {
      return { sent: false, reason: "report_already_created" as const, reportId };
    }
    throw error;
  }

  try {
    const sesMessageId = await sendInventoryDigestEmail({
      reportId,
      reportDate,
      lowStockProducts,
      outOfStockProducts
    });
    await markInventoryReportAccepted(reportId, sesMessageId);
    return { sent: true, reportId, sesMessageId, productCount: products.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SES send failure";
    await markInventoryReportFailed(reportId, message);
    // Daily inventory mail is intentionally not retried immediately; tomorrow's digest re-evaluates stock.
    return { sent: false, reason: "ses_send_failed" as const, reportId };
  }
}
