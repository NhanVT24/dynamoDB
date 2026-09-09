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

export function feedbackUpdate(
  status: FeedbackStatus,
  occurredAt: string,
  now: string,
  messageId: string,
  options: { timestampField?: string; storeMessageId?: boolean; preserveTimestamp?: boolean } = {}
) {
  const values: Record<string, string> = { ":status": status, ":eventAt": occurredAt, ":now": now, ":messageId": messageId };
  const placeholders = feedbackTransition(status).map((state, i) => {
    values[`:from${i}`] = state;
    return `:from${i}`;
  });
  const timestampFields: Record<FeedbackStatus, string> = {
    accepted: "acceptedAt", delivered: "deliveredAt", bounced: "bouncedAt",
    complained: "complainedAt", rejected: "rejectedAt", delivery_delayed: "delayedAt"
  };
  const timestampField = options.timestampField ?? timestampFields[status];
  const storeMessageId = options.storeMessageId ?? true;
  const preserveTimestamp = options.preserveTimestamp ?? true;
  if (!storeMessageId) delete values[":messageId"];
  const messageCondition = storeMessageId ? " AND (attribute_not_exists(sesMessageId) OR sesMessageId = :messageId)" : "";
  const messageUpdate = storeMessageId ? ", sesMessageId = :messageId" : "";
  return {
    ConditionExpression: `attribute_exists(PK) AND #status IN (${placeholders.join(", ")})${messageCondition}`,
    UpdateExpression: `SET #status = :status${messageUpdate}, ${timestampField} = ${preserveTimestamp ? `if_not_exists(${timestampField}, :eventAt)` : ":eventAt"}, updatedAt = :now`,
    ExpressionAttributeNames: { "#status": "status" },
    values
  };
}
