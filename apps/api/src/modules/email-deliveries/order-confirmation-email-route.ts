import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { QueueOrderConfirmation } from "./application/queue-order-confirmation.js";
import { emailAdministrationPorts } from "./infrastructure/email-administration-ports.js";
import type { ConfirmationMail } from "./domain/email-jobs.js";
export function queueOrderConfirmationEmail(input:ConfirmationMail) {
 return new QueueOrderConfirmation(emailAdministrationPorts,Boolean(env.EVENTBRIDGE_PLATFORM_BUS_NAME),value=>crypto.createHash("sha256").update(value).digest("hex")).execute(input);
}
