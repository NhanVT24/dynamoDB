import { EmailRecipient } from "./email-recipient.js";
export type FeedbackStatus = "accepted" | "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed";
export function feedbackTransition(status: FeedbackStatus) { return EmailRecipient.allowedPredecessors(status); }
