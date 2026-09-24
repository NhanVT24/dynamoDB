import { env } from "../../config/env.js";

export function authSenderEmail() {
  return env.SES_AUTH_FROM_EMAIL ?? env.SES_FROM_EMAIL;
}

export function ordersSenderEmail() {
  return env.SES_ORDERS_FROM_EMAIL ?? env.SES_FROM_EMAIL;
}

export function replyToAddresses() {
  return env.SES_REPLY_TO_EMAIL ? [env.SES_REPLY_TO_EMAIL] : undefined;
}
