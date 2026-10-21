export type FeedbackStatus = "accepted" | "delivered" | "bounced" | "complained" | "rejected" | "delivery_delayed";
// Explicit transitions, rather than a numeric rank: complaints and delayed bounces
// can follow delivery. Intermediate events must never overwrite a final outcome.
export function feedbackTransition(status: FeedbackStatus) {
    const allowed: Record<FeedbackStatus, string[]> = {
        accepted: ["pending", "failed"],
        delivery_delayed: ["pending", "accepted", "failed"],
        delivered: ["pending", "accepted", "delivery_delayed", "failed"],
        bounced: ["pending", "accepted", "delivery_delayed", "failed", "delivered"],
        rejected: ["pending", "accepted", "delivery_delayed", "failed"],
        complained: ["pending", "accepted", "delivery_delayed", "failed", "delivered", "bounced", "rejected"]
    };
    return allowed[status];
}
