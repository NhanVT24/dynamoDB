import { env } from "../config/env.js";
import { sendInventoryDigestEmail } from "../integrations/ses/inventory-report-mailer.js";
import {
  createPendingInventoryReport,
  getInventoryReport,
  markInventoryReportAccepted
} from "../modules/inventory-reports/inventory-report.repository.js";

const simulatorRecipients = {
  success: "success@simulator.amazonses.com",
  bounce: "bounce@simulator.amazonses.com"
} as const;

type SimulatorScenario = keyof typeof simulatorRecipients;

function readScenario() {
  const value = process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length);
  if (value === "success" || value === "bounce") {
    return value;
  }

  throw new Error("Use --scenario=success or --scenario=bounce.");
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

  try {
    const sesMessageId = await sendInventoryDigestEmail({
      reportId,
      reportDate,
      lowStockProducts: [],
      outOfStockProducts: [],
      recipientEmail
    });
    await markInventoryReportAccepted(reportId, sesMessageId);

    console.log(JSON.stringify({
      reportId,
      scenario,
      recipientEmail,
      sesMessageId,
      expectedStatus: scenario === "success" ? "delivered" : "bounced",
      dynamoKey: `INVENTORY_REPORT#${reportId}`
    }, null, 2));
    console.log("Wait briefly for SES -> SNS -> Lambda, then query the DynamoDB record or inspect the SES inventory event Lambda logs.");
  } catch (error) {
    console.error(`SES simulator test failed for reportId=${reportId}.`, error);
    throw error;
  }
}

void main().catch((error) => {
  console.error("SES simulator test could not start.", error);
  process.exitCode = 1;
});
