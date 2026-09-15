import "reflect-metadata";
import { z } from "zod";
import { markEmailRouteRuleMatched } from "../../../modules/email-deliveries/email-route.repository.js";

const routeDetailSchema = z.object({
  emailJobId: z.string().length(64),
  campaignId: z.string().min(1)
});

const eventSchema = z.union([
  z.object({
    id: z.string().optional(),
    source: z.literal("supermarket.email"),
    "detail-type": z.literal("email.sale_campaign.requested"),
    detail: routeDetailSchema
  }),
  // Isolated infrastructure test event. No production email Rule matches this
  // source/detail-type pair, so running the DLQ test can never send an email.
  z.object({
    id: z.string().optional(),
    source: z.literal("supermarket.email.test"),
    "detail-type": z.enum([
      "email.eventbridge.delivery-failure.test",
      "email.eventbridge.delivery-success.test"
    ]),
    detail: routeDetailSchema.extend({ testId: z.string().min(1) })
  })
]);

export const handler = async (rawEvent: unknown) => {
  const event = eventSchema.parse(rawEvent);
  const advanced = await markEmailRouteRuleMatched(event.detail.emailJobId);

  console.log(JSON.stringify({
    flow: "email_routing",
    stage: advanced ? "rule_matched" : "rule_match_already_recorded_or_untracked",
    emailJobId: event.detail.emailJobId,
    campaignId: event.detail.campaignId,
    eventId: event.id ?? "",
    testId: "testId" in event.detail ? event.detail.testId : undefined
  }));

  return { tracked: advanced };
};
