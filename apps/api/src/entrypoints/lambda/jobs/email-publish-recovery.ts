import "reflect-metadata";
import { env } from "../../../config/env.js";
import { publishEventBridgeEvent } from "../../../integrations/eventbridge/publisher.js";
import { publishAdminAlert } from "../../../integrations/sns/publisher.js";
import { nextEmailPublishRetryAt } from "../../../modules/email-deliveries/email-publish-retry.js";
import {
  claimEmailRoutePublish,
  findDueEmailRoutePublishes,
  markEmailRouteAlertResult,
  markEmailRoutePublished,
  markEmailRoutePublishFailed,
  markEmailRoutePublishRetry,
  type EmailRouteRecord
} from "../../../modules/email-deliveries/email-route.repository.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown EventBridge publish failure";
}

async function failPermanently(route: EmailRouteRecord, reason: string) {
  const changed = await markEmailRoutePublishFailed({
    emailJobId: route.emailJobId,
    attempt: route.publishAttempts,
    reason
  });
  if (!changed) return false;

  try {
    const alert = await publishAdminAlert({
      subject: "[Supermarket] EventBridge email publish failed",
      message: [
        `Email event publishing failed after ${route.publishAttempts} attempts.`,
        `emailJobId=${route.emailJobId}`,
        `campaignId=${route.campaignId}`,
        `lastError=${reason}`,
        "Inspect the EMAIL_ROUTE record before starting a manual retry."
      ].join("\n"),
      attributes: {
        alertType: "EMAIL_EVENT_PUBLISH_FAILED",
        emailJobId: route.emailJobId,
        campaignId: route.campaignId
      }
    });
    await markEmailRouteAlertResult({
      emailJobId: route.emailJobId,
      sent: true,
      messageId: alert.messageId
    });
  } catch (error) {
    console.error(JSON.stringify({
      flow: "email_publish_recovery",
      stage: "admin_alert_failed",
      emailJobId: route.emailJobId,
      message: errorMessage(error)
    }));
    try {
      await markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: false });
    } catch (updateError) {
      console.error(JSON.stringify({
        flow: "email_publish_recovery",
        stage: "alert_status_update_failed",
        emailJobId: route.emailJobId,
        message: errorMessage(updateError)
      }));
    }
  }

  return true;
}

export const handler = async (_event: unknown, context?: { awsRequestId?: string }) => {
  const now = new Date().toISOString();
  const candidates = await findDueEmailRoutePublishes(now);
  let claimed = 0;
  let published = 0;
  let rescheduled = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (candidate.publishAttempts >= env.EMAIL_EVENT_PUBLISH_MAX_ATTEMPTS) {
      if (await failPermanently(candidate, candidate.publishFailureReason ?? "Publish attempt lease expired")) failed += 1;
      continue;
    }

    const leaseUntil = new Date(Date.now() + env.EMAIL_EVENT_PUBLISH_LEASE_SECONDS * 1_000).toISOString();
    const route = await claimEmailRoutePublish({
      emailJobId: candidate.emailJobId,
      expectedAttempt: candidate.publishAttempts,
      maxAttempts: env.EMAIL_EVENT_PUBLISH_MAX_ATTEMPTS,
      now,
      leaseUntil
    });
    if (!route) continue;
    claimed += 1;

    if (!route.eventSource || !route.eventDetailType || !route.eventDetail) {
      if (await failPermanently(route, "EMAIL_ROUTE is missing the persisted EventBridge payload")) failed += 1;
      continue;
    }

    try {
      const event = await publishEventBridgeEvent({
        busName: route.eventBusName,
        source: route.eventSource,
        detailType: route.eventDetailType,
        detail: route.eventDetail
      });
      await markEmailRoutePublished({ emailJobId: route.emailJobId, eventId: event.eventId });
      published += 1;
    } catch (error) {
      const reason = errorMessage(error);
      if (route.publishAttempts >= env.EMAIL_EVENT_PUBLISH_MAX_ATTEMPTS) {
        if (await failPermanently(route, reason)) failed += 1;
        continue;
      }

      const scheduled = await markEmailRoutePublishRetry({
        emailJobId: route.emailJobId,
        attempt: route.publishAttempts,
        reason,
        nextPublishAt: nextEmailPublishRetryAt(route.publishAttempts)
      });
      if (scheduled) rescheduled += 1;
    }
  }

  const result = { evaluated: candidates.length, claimed, published, rescheduled, failed };
  console.log(JSON.stringify({
    flow: "email_publish_recovery",
    stage: "completed",
    requestId: context?.awsRequestId ?? "",
    ...result
  }));
  return result;
};

