import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { env } from "../../config/env.js";
import { sendInventoryDigestEmail } from "../../integrations/ses/inventory-report-mailer.js";
import {
  listInventoryReportProducts,
  markInventoryReportProductsAlerted
} from "../shopping/shopping.repository.js";
import {
  createPendingInventoryReport,
  markInventoryReportAccepted,
  markInventoryReportFailed
} from "./inventory-report.repository.js";

function getVietnamReportDate(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function isBiDailyInventoryReportDate(reportDate: string) {
  const [year, month, day] = reportDate.split("-").map(Number);
  const currentReportDate = Date.UTC(year, month - 1, day);
  const firstReportDate = Date.UTC(2026, 0, 1);
  const elapsedDays = Math.floor((currentReportDate - firstReportDate) / 86_400_000);

  return elapsedDays >= 0 && elapsedDays % 2 === 0;
}

export async function sendDailyInventoryReport(referenceDate = new Date()) {
  if (!env.ADMIN_REPORT_EMAIL) {
    throw new Error("Missing ADMIN_REPORT_EMAIL configuration.");
  }

  const reportDate = getVietnamReportDate(referenceDate);
  if (!isBiDailyInventoryReportDate(reportDate)) {
    return { sent: false, reason: "not_scheduled_report_date" as const, reportDate };
  }

  const products = await listInventoryReportProducts();
  if (products.length === 0) {
    return { sent: false, reason: "no_low_or_out_of_stock_products" as const };
  }

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

  let sesMessageId: string;
  try {
    sesMessageId = await sendInventoryDigestEmail({
      reportId,
      reportDate,
      lowStockProducts,
      outOfStockProducts
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SES send failure";
    await markInventoryReportFailed(reportId, message);
    // Daily inventory mail is intentionally not retried immediately; the next scheduled run re-evaluates stock.
    return { sent: false, reason: "ses_send_failed" as const, reportId };
  }

  await markInventoryReportAccepted(reportId, sesMessageId);

  try {
    const alertedProductCount = await markInventoryReportProductsAlerted(products);
    return { sent: true, reportId, sesMessageId, productCount: products.length, alertedProductCount };
  } catch (error) {
    console.error("[inventory-report] alert_state_update_failed", {
      reportId,
      error: error instanceof Error ? error.message : "Unknown alert state update failure"
    });
    return { sent: true, reportId, sesMessageId, productCount: products.length, alertedProductCount: 0 };
  }
}
