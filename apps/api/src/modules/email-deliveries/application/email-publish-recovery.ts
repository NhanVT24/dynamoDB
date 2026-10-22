import { EmailRoute } from "../domain/email-route.js";
import type { ApplicationLogger } from "../../../common/application/queue-events.js";
import type { EmailRecoveryPorts, RecoverableEmailRoute } from "./recovery-ports.js";
function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown EventBridge publish failure";
}
export class RecoverEmailPublishes {
    constructor(private readonly ports: EmailRecoveryPorts, private readonly config: {
        maxAttempts: number;
        leaseSeconds: number;
    }, private readonly logger: ApplicationLogger, private readonly now: () => number = Date.now) { }
    private async failPermanently(route: RecoverableEmailRoute, reason: string) {
        const changed = await this.ports.markEmailRoutePublishFailed({
            emailJobId: route.emailJobId,
            attempt: route.publishAttempts,
            reason
        });
        if (!changed)
            return false;
        try {
            const alert = await this.ports.publishAdminAlert({
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
            await this.ports.markEmailRouteAlertResult({
                emailJobId: route.emailJobId,
                sent: true,
                messageId: alert.messageId
            });
        }
        catch (error) {
            this.logger.error(JSON.stringify({
                flow: "email_publish_recovery",
                stage: "admin_alert_failed",
                emailJobId: route.emailJobId,
                message: errorMessage(error)
            }));
            try {
                await this.ports.markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: false });
            }
            catch (updateError) {
                this.logger.error(JSON.stringify({
                    flow: "email_publish_recovery",
                    stage: "alert_status_update_failed",
                    emailJobId: route.emailJobId,
                    message: errorMessage(updateError)
                }));
            }
        }
        return true;
    }
    async execute(requestId?: string) {
        const now = new Date(this.now()).toISOString();
        const candidates = await this.ports.findDueEmailRoutePublishes(now);
        let claimed = 0;
        let published = 0;
        let rescheduled = 0;
        let failed = 0;
        for (const candidate of candidates) {
            if (new EmailRoute(candidate).exhausted(this.config.maxAttempts)) {
                if (await this.failPermanently(candidate, candidate.publishFailureReason ?? "Publish attempt lease expired"))
                    failed += 1;
                continue;
            }
            const leaseUntil = new Date(this.now() + this.config.leaseSeconds * 1000).toISOString();
            const route = await this.ports.claimEmailRoutePublish({
                emailJobId: candidate.emailJobId,
                expectedAttempt: candidate.publishAttempts,
                maxAttempts: this.config.maxAttempts,
                now,
                leaseUntil
            });
            if (!route)
                continue;
            claimed += 1;
            if (!new EmailRoute(route).hasPublishPayload) {
                if (await this.failPermanently(route, "EMAIL_ROUTE is missing the persisted EventBridge payload"))
                    failed += 1;
                continue;
            }
            try {
                const event = await this.ports.publishRoute(route);
                await this.ports.markEmailRoutePublished({ emailJobId: route.emailJobId, eventId: event.eventId });
                published += 1;
            }
            catch (error) {
                const reason = errorMessage(error);
                if (new EmailRoute(route).exhausted(this.config.maxAttempts)) {
                    if (await this.failPermanently(route, reason))
                        failed += 1;
                    continue;
                }
                const scheduled = await this.ports.markEmailRoutePublishRetry({
                    emailJobId: route.emailJobId,
                    attempt: route.publishAttempts,
                    reason,
                    nextPublishAt: this.ports.nextEmailPublishRetryAt(route.publishAttempts)
                });
                if (scheduled)
                    rescheduled += 1;
            }
        }
        const result = { evaluated: candidates.length, claimed, published, rescheduled, failed };
        this.logger.log(JSON.stringify({
            flow: "email_publish_recovery",
            stage: "completed",
            requestId: requestId ?? "",
            ...result
        }));
        return result;
    }
}
