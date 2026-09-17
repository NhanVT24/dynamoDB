import { readCsvEnv } from "./env.js";

export function assertSignUpEmailAllowed(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email is not valid.");
  }

  const domain = email.split("@").pop()?.toLowerCase() ?? "";
  const allowedDomains = readCsvEnv("COGNITO_SIGNUP_ALLOWED_EMAIL_DOMAINS");
  const blockedDomains = readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAIL_DOMAINS");
  const blockedEmails = readCsvEnv("COGNITO_SIGNUP_BLOCKED_EMAILS");

  if (blockedEmails.includes(email)) {
    throw new Error("This email cannot be used to create an account.");
  }

  if (blockedDomains.includes(domain)) {
    throw new Error("This email domain cannot be used to create an account.");
  }

  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    throw new Error("This email domain is not allowed to create an account.");
  }
}
