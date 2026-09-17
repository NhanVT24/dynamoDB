import { env } from "../../config/env.js";
import { sendSharedEmail } from "./bulk-mailer.js";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendWelcomeEmail(input: {
  emailJobId: string;
  toEmail: string;
  displayName?: string;
  userSub: string;
}) {
  if (!env.SES_FROM_EMAIL) {
    throw new Error("Missing SES_FROM_EMAIL for welcome email.");
  }

  const name = input.displayName?.trim() || input.toEmail;
  const subject = "Welcome to Supermarket";
  const html = `
    <div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#0f172a;background:#ffffff;">
      <h1 style="margin:0 0 12px;font-size:24px;color:#166534;">Your account is ready</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Your Supermarket account has been created successfully. You can now sign in, browse products, and place orders.
      </p>
      <p style="margin:24px 0 0;font-size:12px;color:#64748b;">If you did not create this account, please ignore this email.</p>
    </div>
  `;
  const text = [
    `Hi ${name},`,
    "",
    "Your Supermarket account has been created successfully.",
    "You can now sign in, browse products, and place orders.",
    "",
    "If you did not create this account, please ignore this email."
  ].join("\n");

  return sendSharedEmail({
    emailId: input.emailJobId,
    emailType: "account_welcome",
    senderEmail: env.SES_FROM_EMAIL,
    subject,
    html,
    text,
    to: input.toEmail,
    relatedId: input.userSub
  });
}
