import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";

function codePlaceholder(event: CognitoTriggerEvent) {
  return event.request.codeParameter || "{####}";
}

function emailOrUserName(event: CognitoTriggerEvent) {
  return normalizeEmail(event.request.userAttributes?.email) || event.userName || "your account";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setEmail(event: CognitoTriggerEvent, subject: string, message: string) {
  event.response.emailSubject = subject;
  event.response.emailMessage = message;
}

export function verificationMessage(input: { code: string; email?: string }) {
  const email = input.email ? escapeHtml(input.email) : "your account";
  return {
    subject: "Confirm your Supermarket account",
    text: [
      "Welcome to Supermarket.",
      "",
      `Use this confirmation code to verify ${input.email || "your account"}:`,
      input.code,
      "",
      "This code expires shortly. If you did not create this account, you can ignore this email."
    ].join("\n"),
    message: [
      "<p>Welcome to <strong>Supermarket</strong>.</p>",
      `<p>Use this confirmation code to verify ${email}:</p>`,
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${escapeHtml(input.code)}</p>`,
      "<p>This code expires shortly. If you did not create this account, you can ignore this email.</p>"
    ].join("")
  };
}

export function resetPasswordMessage(input: { code: string }) {
  return {
    subject: "Reset your Supermarket password",
    text: [
      "We received a request to reset your Supermarket password.",
      "",
      "Use this code to continue:",
      input.code,
      "",
      "If you did not request a password reset, you can ignore this email."
    ].join("\n"),
    message: [
      "<p>We received a request to reset your Supermarket password.</p>",
      "<p>Use this code to continue:</p>",
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${escapeHtml(input.code)}</p>`,
      "<p>If you did not request a password reset, you can ignore this email.</p>"
    ].join("")
  };
}

export function authenticationCodeMessage(input: { code: string }) {
  return {
    subject: "Your Supermarket sign-in code",
    text: [
      "Use this code to sign in to your Supermarket account:",
      input.code,
      "",
      "If you did not try to sign in, you can ignore this email."
    ].join("\n"),
    message: [
      "<p>Use this code to sign in to your Supermarket account:</p>",
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${escapeHtml(input.code)}</p>`,
      "<p>If you did not try to sign in, you can ignore this email.</p>"
    ].join("")
  };
}

export function adminCreateUserMessage(input: { code: string; username?: string }) {
  const username = input.username || "your account";
  return {
    subject: "Your Supermarket account was created",
    text: [
      "An administrator created a Supermarket account for you.",
      "",
      `Username: ${username}`,
      `Temporary password/code: ${input.code}`,
      "",
      "Please sign in and update your password when prompted."
    ].join("\n"),
    message: [
      "<p>An administrator created a Supermarket account for you.</p>",
      `<p>Username: <strong>${escapeHtml(username)}</strong></p>`,
      `<p>Temporary password/code: <strong>${escapeHtml(input.code)}</strong></p>`,
      "<p>Please sign in and update your password when prompted.</p>"
    ].join("")
  };
}

function customMessageTemplate(event: CognitoTriggerEvent) {
  const code = codePlaceholder(event);
  switch (event.triggerSource) {
    case "CustomMessage_SignUp":
    case "CustomMessage_ResendCode":
      return verificationMessage({ code, email: emailOrUserName(event) });
    case "CustomMessage_ForgotPassword":
      return resetPasswordMessage({ code });
    case "CustomMessage_AdminCreateUser":
      return adminCreateUserMessage({ code, username: event.request.usernameParameter || event.userName });
    default:
      return undefined;
  }
}

export async function TriggerCustomMessage(event: CognitoTriggerEvent) {
  const content = customMessageTemplate(event);

  if (content) {
    setEmail(event, content.subject, content.message);
  }

  return event;
}
