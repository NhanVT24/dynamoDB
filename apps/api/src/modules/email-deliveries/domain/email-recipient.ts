import type { FeedbackStatus } from "./email-feedback.js";
export class EmailRecipient {
    constructor(readonly recipientEmail: string, readonly status?: string) { Object.freeze(this); }
    canTransitionTo(status: FeedbackStatus) { return this.status !== undefined && EmailRecipient.allowedPredecessors(status).includes(this.status); }
    isAffected(addresses?: readonly string[]) { return !addresses || addresses.some(address => address.toLowerCase() === this.recipientEmail.toLowerCase()); }
    static allowedPredecessors(status: FeedbackStatus): string[] {
        const allowed: Record<FeedbackStatus, string[]> = {
            accepted: ["pending", "failed"],
            delivery_delayed: ["pending", "accepted", "failed"],
            delivered: ["pending", "accepted", "delivery_delayed", "failed"],
            bounced: ["pending", "accepted", "delivery_delayed", "failed", "delivered"],
            rejected: ["pending", "accepted", "delivery_delayed", "failed"],
            complained: ["pending", "accepted", "delivery_delayed", "failed", "delivered", "bounced", "rejected"]
        };
        return [...allowed[status]];
    }
}
