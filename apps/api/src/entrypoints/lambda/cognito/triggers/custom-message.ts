import type { CognitoTriggerEvent } from "../types.js";
import { normalizeEmail } from "../helper/attributes.js";

function codePlaceholder(event: CognitoTriggerEvent) {
  return event.request.codeParameter || "{####}";
}

function emailOrUserName(event: CognitoTriggerEvent) {
  return normalizeEmail(event.request.userAttributes?.email) || event.userName || "your account";
}

function setEmail(event: CognitoTriggerEvent, subject: string, message: string) {
  event.response.emailSubject = subject;
  event.response.emailMessage = message;
}

function verificationMessage(event: CognitoTriggerEvent) {
  const code = codePlaceholder(event);
  const email = emailOrUserName(event);
  return {
    subject: "Confirm your Supermarket account",
    message: [
      "<p>Welcome to <strong>Supermarket</strong>.</p>",
      `<p>Use this confirmation code to verify ${email}:</p>`,
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>`,
      "<p>This code expires shortly. If you did not create this account, you can ignore this email.</p>"
    ].join("")
  };
}

function resetPasswordMessage(event: CognitoTriggerEvent) {
  const code = codePlaceholder(event);
  return {
    subject: "Reset your Supermarket password",
    message: [
      "<p>We received a request to reset your Supermarket password.</p>",
      "<p>Use this code to continue:</p>",
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>`,
      "<p>If you did not request a password reset, you can ignore this email.</p>"
    ].join("")
  };
}

function adminCreateUserMessage(event: CognitoTriggerEvent) {
  const code = codePlaceholder(event);
  const username = event.request.usernameParameter || event.userName;
  return {
    subject: "Your Supermarket account was created",
    message: [
      "<p>An administrator created a Supermarket account for you.</p>",
      `<p>Username: <strong>${username}</strong></p>`,
      `<p>Temporary password/code: <strong>${code}</strong></p>`,
      "<p>Please sign in and update your password when prompted.</p>"
    ].join("")
  };
}

export async function TriggerCustomMessage(event: CognitoTriggerEvent) {
  let content: { subject: string; message: string } | undefined;

  switch (event.triggerSource) {
    case "CustomMessage_SignUp":
    case "CustomMessage_ResendCode":
      content = verificationMessage(event);
      break;
    case "CustomMessage_ForgotPassword":
      content = resetPasswordMessage(event);
      break;
    case "CustomMessage_AdminCreateUser":
      content = adminCreateUserMessage(event);
      break;
    default:
      break;
  }

  if (content) {
    setEmail(event, content.subject, content.message);
  }

  return event;
}
