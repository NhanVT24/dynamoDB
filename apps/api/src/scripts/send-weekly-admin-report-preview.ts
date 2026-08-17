import { buildWeeklyRevenueSummary } from "../modules/storefront/storefront.reporting.js";
import { buildSampleWeeklyRevenueSummary } from "../modules/storefront/storefront.reporting.samples.js";
import { sendWeeklyRevenueReportEmail } from "../integrations/ses/admin-report-mailer.js";

async function main() {
  let summary;

  try {
    summary = await buildWeeklyRevenueSummary();
  } catch (error) {
    const candidate = error as { name?: string; message?: string };
    if (candidate?.name !== "ResourceNotFoundException") {
      throw error;
    }

    console.warn("[mail-ses] weekly_admin_report_preview_fallback_sample", {
      reason: candidate.message ?? "resource_not_found"
    });
    summary = buildSampleWeeklyRevenueSummary();
  }

  await sendWeeklyRevenueReportEmail(summary);

  console.log("[mail-ses] weekly_admin_report_preview_sent", {
    to: process.env.ADMIN_REPORT_EMAIL ?? "",
    orderCount: summary.orderCount,
    totalRevenue: summary.totalRevenue,
    rangeStart: summary.rangeStart,
    rangeEnd: summary.rangeEnd
  });
}

main().catch((error) => {
  console.error("[mail-ses] weekly_admin_report_preview_failed", error);
  process.exitCode = 1;
});
