import "reflect-metadata";
import { env } from "../../../config/env.js";
import { publishAdminAlert } from "../../../integrations/sns/publisher.js";
import {
  findStalePublishedEmailRoutes,
  markEmailRouteAlertResult,
  markEmailRouteRoutingSuspected
} from "../../../modules/email-deliveries/email-route.repository.js";

export const handler = async (_event: unknown, context?: { awsRequestId?: string }) => {
  const timeoutSeconds = env.EMAIL_ROUTING_ACK_TIMEOUT_SECONDS;
  const cutoff = new Date(Date.now() - timeoutSeconds * 1_000).toISOString();
  const staleRoutes = await findStalePublishedEmailRoutes(cutoff);

  console.log(JSON.stringify({
    flow: "email_routing_watchdog",
    stage: "scan_completed",
    requestId: context?.awsRequestId ?? "",
    cutoff,
    timeoutSeconds,
    staleCandidateCount: staleRoutes.length
  }));

  let suspected = 0;
  let alertsSent = 0;
  let alertsFailed = 0;

  for (const route of staleRoutes) {
    if (!await markEmailRouteRoutingSuspected(route.emailJobId)) continue;
    suspected += 1;

    console.error(JSON.stringify({
      flow: "email_routing_watchdog",
      stage: "rule_match_timeout",
      emailJobId: route.emailJobId,
      campaignId: route.campaignId,
      eventId: route.eventId ?? "",
      publishedAt: route.publishedAt ?? "",
      cutoff
    }));

    try {
      const alert = await publishAdminAlert({
        subject: "[Supermarket] EventBridge email routing timeout",
        message: [
          "An email event was accepted by EventBridge but did not receive a rule-match acknowledgement within the configured SLA.",
          `emailJobId=${route.emailJobId}`,
          `campaignId=${route.campaignId}`,
          `eventId=${route.eventId ?? "unknown"}`,
          `publishedAt=${route.publishedAt ?? "unknown"}`,
          "Check the EventBridge rule state/pattern before starting an Archive Replay."
        ].join("\n"),
        attributes: {
          alertType: "EMAIL_RULE_MISS_SUSPECTED",
          emailJobId: route.emailJobId,
          campaignId: route.campaignId
        }
      });
      await markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: true, messageId: alert.messageId });
      alertsSent += 1;
    } catch (error) {
      alertsFailed += 1;
      console.error(JSON.stringify({
        flow: "email_routing_watchdog",
        stage: "admin_alert_failed",
        emailJobId: route.emailJobId,
        message: error instanceof Error ? error.message : "unknown"
      }));
      try {
        await markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: false });
      } catch (updateError) {
        console.error(JSON.stringify({
          flow: "email_routing_watchdog",
          stage: "alert_status_update_failed",
          emailJobId: route.emailJobId,
          message: updateError instanceof Error ? updateError.message : "unknown"
        }));
      }
    }
  }

  const result = { evaluated: staleRoutes.length, suspected, alertsSent, alertsFailed };
  console.log(JSON.stringify({ flow: "email_routing_watchdog", stage: "completed", ...result }));
  return result;
};
