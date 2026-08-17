import "reflect-metadata";
import { sendWeeklyRevenueReportEmail } from "./integrations/ses/admin-report-mailer.js";

type MailWorkflowInput = {
  mailType?: string;
  summary?: Parameters<typeof sendWeeklyRevenueReportEmail>[0];
};

export const handler = async (event: MailWorkflowInput) => {
  if (event.mailType !== "weekly-revenue-report" || !event.summary) {
    throw new Error(`Unsupported workflow mail type: ${event.mailType ?? "unknown"}`);
  }

  await sendWeeklyRevenueReportEmail(event.summary);
  return {
    sent: true,
    mailType: event.mailType
  };
};
