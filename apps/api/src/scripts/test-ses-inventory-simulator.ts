import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "../config/env.js";
import { sesClient } from "../integrations/ses/client.js";
import { getInventoryDigestSubject, sendInventoryDigestEmail } from "../integrations/ses/inventory-report-mailer.js";
import {
  createPendingEmailDelivery,
  createPendingEmailDeliveryBatch,
  markEmailDeliveryAccepted,
  markEmailDeliveryFailed,
  markEmailAccepted,
  markEmailFailed,
  markEmailRecipientAccepted,
  markEmailRecipientFailed,
  sesTrackingTags
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
type RequestedScenario = SimulatorScenario | "all" | "layout" | "layout-simulator";

function readScenario() {
  const value = process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length);
  if (value === "success" || value === "bounce" || value === "complaint" || value === "all" || value === "layout" || value === "layout-simulator") {
    return value;
  }

  throw new Error("Use --scenario=layout-simulator, --scenario=layout, --scenario=all, --scenario=success, --scenario=bounce, or --scenario=complaint.");
}

function readRequiredArgument(name: string) {
  const value = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
  if (!value) throw new Error(`Missing --${name}=email@example.com.`);
  return value;
}

async function sendScenario(scenario: SimulatorScenario) {
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

    return {
      reportId,
      scenario,
      recipientEmail,
      sesMessageId,
      expectedStatus: scenario === "success" ? "delivered" : scenario === "bounce" ? "bounced" : "complained",
      reportDynamoKey: `INVENTORY_REPORT#${reportId}`,
      emailDynamoKey: `EMAIL#${email.id}`,
      recipientDynamoKey: `EMAIL#${email.id} / RECIPIENT#${email.id}`
    };
  } catch (error) {
    await markEmailDeliveryFailed(email.id, error instanceof Error ? error.message : "Unknown SES send failure");
    console.error(`SES simulator test failed for reportId=${reportId}.`, error);
    throw error;
  }
}

async function sendGroupedScenario() {
  const subject = "SES feedback grouped simulator test";
  const { meta, recipients } = await createPendingEmailDeliveryBatch({
    emailType: "sale_campaign",
    senderEmail: env.SES_FROM_EMAIL ?? "",
    subject,
    recipients: Object.entries(simulatorRecipients).map(([scenario, email]) => ({ email, type: "to" }))
  });

  try {
    // One SES message, one META, three recipient children. There is deliberately
    // no recipientId tag: SES feedback identifies the affected email addresses.
    const result = await sesClient.send(new SendEmailCommand({
      FromEmailAddress: env.SES_FROM_EMAIL,
      Destination: { ToAddresses: recipients.map((recipient) => recipient.recipientEmail) },
      ConfigurationSetName: env.SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME,
      EmailTags: sesTrackingTags({ emailId: meta.id, emailType: "sale_campaign" }),
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: "SES grouped simulator delivery tracking test.", Charset: "UTF-8" } }
        }
      }
    }));
    if (!result.MessageId) throw new Error("SES accepted the grouped test without a MessageId.");
    await Promise.all([
      markEmailAccepted(meta.id, result.MessageId),
      ...recipients.map((recipient) => markEmailRecipientAccepted({ emailId: meta.id, recipientId: recipient.recipientId }))
    ]);

    return {
      emailDynamoKey: `EMAIL#${meta.id}`,
      meta: { key: `EMAIL#${meta.id} / META`, recipientCount: meta.recipientCount },
      sesMessageId: result.MessageId,
      recipients: recipients.map((recipient) => ({
        scenario: Object.entries(simulatorRecipients).find(([, email]) => email === recipient.recipientEmail)?.[0],
        recipientEmail: recipient.recipientEmail,
        expectedStatus: recipient.recipientEmail === simulatorRecipients.success
          ? "delivered"
          : recipient.recipientEmail === simulatorRecipients.bounce ? "bounced" : "complained",
        key: `EMAIL#${meta.id} / ${recipient.SK}`
      }))
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Unknown SES send failure";
    await Promise.allSettled([markEmailFailed(meta.id, failureReason), ...recipients.map((recipient) => markEmailRecipientFailed({
      emailId: meta.id,
      recipientId: recipient.recipientId,
      failureReason
    }))]);
    throw error;
  }
}

async function sendTrackedLayout(input: {
  label: string;
  subject: string;
  recipients: Array<{ email: string; type: "to" | "cc" | "bcc" }>;
}) {
  const { meta, recipients } = await createPendingEmailDeliveryBatch({
    emailType: "sale_campaign",
    senderEmail: env.SES_FROM_EMAIL ?? "",
    subject: input.subject,
    recipients: input.recipients
  });

  const toAddresses = recipients.filter((recipient) => recipient.recipientType === "to").map((recipient) => recipient.recipientEmail);
  const ccAddresses = recipients.filter((recipient) => recipient.recipientType === "cc").map((recipient) => recipient.recipientEmail);
  const bccAddresses = recipients.filter((recipient) => recipient.recipientType === "bcc").map((recipient) => recipient.recipientEmail);

  try {
    const result = await sesClient.send(new SendEmailCommand({
      FromEmailAddress: env.SES_FROM_EMAIL,
      Destination: {
        ToAddresses: toAddresses,
        ...(ccAddresses.length ? { CcAddresses: ccAddresses } : {}),
        ...(bccAddresses.length ? { BccAddresses: bccAddresses } : {})
      },
      ConfigurationSetName: env.SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME,
      // A one-recipient message has direct correlation. Shared messages use
      // SES's affected-recipient address list when feedback returns.
      EmailTags: sesTrackingTags({
        emailId: meta.id,
        ...(recipients.length === 1 ? { recipientId: recipients[0].recipientId } : {}),
        emailType: "sale_campaign"
      }),
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: { Text: { Data: `SES recipient layout test: ${input.label}.`, Charset: "UTF-8" } }
        }
      }
    }));
    if (!result.MessageId) throw new Error("SES accepted the layout test without a MessageId.");
    await Promise.all([
      markEmailAccepted(meta.id, result.MessageId),
      ...recipients.map((recipient) => markEmailRecipientAccepted({ emailId: meta.id, recipientId: recipient.recipientId }))
    ]);
    return {
      label: input.label,
      emailDynamoKey: `EMAIL#${meta.id}`,
      metaKey: `EMAIL#${meta.id} / META`,
      sesMessageId: result.MessageId,
      recipients: recipients.map((recipient) => ({
        email: recipient.recipientEmail,
        type: recipient.recipientType,
        key: `EMAIL#${meta.id} / ${recipient.SK}`
      }))
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Unknown SES send failure";
    await Promise.allSettled([markEmailFailed(meta.id, failureReason), ...recipients.map((recipient) => markEmailRecipientFailed({
      emailId: meta.id,
      recipientId: recipient.recipientId,
      failureReason
    }))]);
    throw error;
  }
}

async function sendRealRecipientLayouts() {
  const to = readRequiredArgument("to");
  const cc = readRequiredArgument("cc");
  const bcc = readRequiredArgument("bcc");

  return sendTrackedLayout({
    label: "to-cc-bcc",
    subject: "SES test - To, CC and BCC recipients",
    recipients: [
      { email: to, type: "to" },
      { email: cc, type: "cc" },
      { email: bcc, type: "bcc" }
    ]
  });
}

async function sendSimulatorRecipientLayout() {
  return sendTrackedLayout({
    label: "to-success-cc-bounce-bcc-complaint",
    subject: "SES test - simulator To, CC and BCC outcomes",
    recipients: [
      { email: simulatorRecipients.success, type: "to" },
      { email: "bounce+cc@simulator.amazonses.com", type: "cc" },
      { email: "complaint+bcc@simulator.amazonses.com", type: "bcc" }
    ]
  });
}

async function main() {
  const requested: RequestedScenario = readScenario();
  if (!env.SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME?.trim()) {
    throw new Error(
      "Missing SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME. Set it to supermarket-inventory-daily-report before running the simulator test."
    );
  }

  if (requested === "all") {
    const grouped = await sendGroupedScenario();
    console.log(JSON.stringify({
      sent: grouped,
      nextStep: "Wait briefly for SES -> SNS -> Lambda, then query the three recipient keys under this one EMAIL partition."
    }, null, 2));
    return;
  }

  if (requested === "layout") {
    const sent = await sendRealRecipientLayouts();
    console.log(JSON.stringify({
      sent,
      nextStep: "SES -> SNS -> Lambda will update each recipient child asynchronously."
    }, null, 2));
    return;
  }

  if (requested === "layout-simulator") {
    const sent = await sendSimulatorRecipientLayout();
    console.log(JSON.stringify({
      sent,
      expectedStatus: {
        to: "delivered",
        cc: "bounced",
        bcc: "complained"
      },
      nextStep: "Wait briefly for SES -> SNS -> Lambda, then query the three recipient keys under this one EMAIL partition."
    }, null, 2));
    return;
  }

  const scenarios: SimulatorScenario[] = [requested];
  const results: Array<Awaited<ReturnType<typeof sendScenario>>> = [];
  const failures: Array<{ scenario: SimulatorScenario; error: string }> = [];

  for (const scenario of scenarios) {
    try {
      results.push(await sendScenario(scenario));
    } catch (error) {
      failures.push({
        scenario,
        error: error instanceof Error ? error.message : "Unknown SES send failure"
      });
    }
  }

  console.log(JSON.stringify({
    sent: results,
    failures,
    nextStep: "Wait briefly for SES -> SNS -> Lambda, then query each recipientDynamoKey."
  }, null, 2));

  if (failures.length > 0) {
    throw new Error(`${failures.length} SES simulator scenario(s) could not be submitted.`);
  }
}

void main().catch((error) => {
  console.error("SES simulator test could not start.", error);
  process.exitCode = 1;
});
