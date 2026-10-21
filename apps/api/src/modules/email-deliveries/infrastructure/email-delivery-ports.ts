import { sendBulkSaleEmailBatch } from "../../../integrations/ses/bulk-mailer.js";
import { sendOrderConfirmationEmail } from "../../../integrations/ses/order-mailer.js";
import { sendWelcomeEmail } from "../../../integrations/ses/welcome-mailer.js";
import { markEmailRouteProcessing } from "../email-route.repository.js";
import type { EmailDeliveryPorts } from "../application/deliver-email-job.js";
export const emailDeliveryPorts: EmailDeliveryPorts = { sendBulkSaleEmailBatch, sendOrderConfirmationEmail, sendWelcomeEmail, markEmailRouteProcessing };
