import { env } from "../config/env.js";
import { sendBulkSaleEmail } from "../integrations/ses/bulk-mailer.js";
import { listEmailRecipients } from "../modules/email-deliveries/email-delivery.repository.js";

// One SendBulkEmail entry per address. These SES mailbox simulators let us
// verify that the same bulk call produces three independent SNS outcomes.
const simulatorRecipients = [
  { scenario: "success", email: "success@simulator.amazonses.com", expectedStatus: "delivered" },
  { scenario: "bounce", email: "bounce@simulator.amazonses.com", expectedStatus: "bounced" },
  { scenario: "complaint", email: "complaint@simulator.amazonses.com", expectedStatus: "complained" }
] as const;

async function main() {
  if (!env.SES_FROM_EMAIL) throw new Error("Missing SES_FROM_EMAIL.");
  if (!env.SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME) {
    throw new Error("Missing SES_INVENTORY_REPORT_CONFIGURATION_SET_NAME. Deploy the SES configuration set before running this test.");
  }

  const attempts = await sendBulkSaleEmail({
    senderEmail: env.SES_FROM_EMAIL,
    subject: `SES bulk tracking simulator - ${new Date().toISOString()}`,
    html: "<p>SES bulk per-recipient tracking test.</p>",
    text: "SES bulk per-recipient tracking test.",
    recipients: simulatorRecipients.map((recipient) => recipient.email)
  });
  const records = await Promise.all(attempts.map(async (attempt) => ({
    ...attempt,
    recipients: (await listEmailRecipients(attempt.emailId)).map((recipient) => ({
      email: recipient.recipientEmail,
      initialStatus: recipient.status,
      sesMessageId: recipient.sesMessageId,
      failureReason: recipient.failureReason,
      key: `${recipient.PK} / ${recipient.SK}`,
      expectedStatus: simulatorRecipients.find((item) => item.email === recipient.recipientEmail)?.expectedStatus
    }))
  })));

  console.log(JSON.stringify({
    sent: records,
    nextStep: "Wait briefly for SES -> SNS -> Lambda, then query the recipient keys. Expected: success=delivered, bounce=bounced, complaint=complained."
  }, null, 2));
}

main().catch((error) => {
  console.error("SES bulk simulator test failed.", error);
  process.exitCode = 1;
});
