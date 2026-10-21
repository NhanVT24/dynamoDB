import { RecordEmailFeedback } from "../application/record-email-feedback.js";
import { listEmailRecipients, markEmailAccepted, updateEmailDeliveryStatus, updateEmailRecipientStatus } from "../email-delivery.repository.js";
import { updateInventoryReportDeliveryStatus } from "../../inventory-reports/inventory-report.repository.js";
export const recordEmailFeedback = new RecordEmailFeedback({ listEmailRecipients, markEmailAccepted, updateEmailDeliveryStatus, updateEmailRecipientStatus, updateInventoryReportDeliveryStatus });
