import { env } from "../config/env.js";
import { getInventoryDigestSubject, sendInventoryDigestEmail } from "../integrations/ses/inventory-report-mailer.js";
import {
  createPendingEmailDelivery,
  markEmailDeliveryAccepted,
  markEmailDeliveryFailed
} from "../modules/email-deliveries/email-delivery.repository.js";
import {
  createPendingInventoryReport,
  getInventoryReport,
  markInventoryReportAccepted
} from "../modules/inventory-reports/inventory-report.repository.js";

const simulatorRecipients = {
  success: "success@simulator.amazonses.com",
  bounce: "bounce@simulator.amazonses.com",
  complaint: "complaint@simulator.amazonses.com"
} as const;

type SimulatorScenario = keyof typeof simulatorRecipients;

function readScenario() {
  const value = process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length);
  if (value === "success" || value === "bounce" || value === "complaint") {
    return value;
  }

  throw new Error("Use --scenario=success, --scenario=bounce, or --scenario=complaint.");
}

async function main() {
  const scenario: SimulatorScenario = readScenario();
  if (!env.SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME?.trim()) {
    throw new Error(
      "Missing SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME. Set it to supermarket-inventory-daily-report before running the simulator test."
    );
  }

  const recipientEmail = simulatorRecipients[scenario];
  const reportId = `ses-simulator-${scenario}-${Date.now()}`;
  const reportDate = new Date().toISOString().slice(0, 10);

  await createPendingInventoryReport({
    reportId,
    reportDate,
    recipientEmail,
    lowStockCount: 0,
    outOfStockCount: 0
  });
  const email = await createPendingEmailDelivery({
    emailType: "inventory_daily_report",
    recipientEmail,
    senderEmail: env.SES_FROM_EMAIL ?? "",
    subject: getInventoryDigestSubject(reportDate),
    reportId
  });

  try {
    const sesMessageId = await sendInventoryDigestEmail({
      emailId: email.id,
      reportId,
      reportDate,
      lowStockProducts: [],
      outOfStockProducts: [],
      recipientEmail
    });
    await Promise.all([
      markInventoryReportAccepted(reportId, sesMessageId),
      markEmailDeliveryAccepted(email.id, sesMessageId)
    ]);

    console.log(JSON.stringify({
      reportId,
      scenario,
      recipientEmail,
      sesMessageId,
      expectedStatus: scenario === "success" ? "delivered" : scenario === "bounce" ? "bounced" : "complained",
      reportDynamoKey: `INVENTORY_REPORT#${reportId}`,
      emailDynamoKey: `EMAIL#${email.id}`
    }, null, 2));
    console.log("Wait briefly for SES -> SNS -> Lambda, then query the DynamoDB record or inspect the SES inventory event Lambda logs.");
  } catch (error) {
    await markEmailDeliveryFailed(email.id, error instanceof Error ? error.message : "Unknown SES send failure");
    console.error(`SES simulator test failed for reportId=${reportId}.`, error);
    throw error;
  }
}

void main().catch((error) => {
  console.error("SES simulator test could not start.", error);
  process.exitCode = 1;
});
