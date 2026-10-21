import type { ApplicationLogger } from "../../../common/application/queue-events.js";
import type { EmailRecoveryPorts } from "./recovery-ports.js";
export class WatchEmailRouting {
    constructor(private readonly ports: EmailRecoveryPorts, private readonly config: {
        ackTimeoutSeconds: number;
    }, private readonly logger: ApplicationLogger, private readonly now: () => number = Date.now) { }
    async execute(requestId?: string) {
        const timeoutSeconds = this.config.ackTimeoutSeconds;
        const cutoff = new Date(this.now() - timeoutSeconds * 1000).toISOString();
        const staleRoutes = await this.ports.findStalePublishedEmailRoutes(cutoff);
        this.logger.log(JSON.stringify({
            flow: "email_routing_watchdog",
            stage: "scan_completed",
            requestId: requestId ?? "",
            cutoff,
            timeoutSeconds,
            staleCandidateCount: staleRoutes.length
        }));
        let suspected = 0;
        let alertsSent = 0;
        let alertsFailed = 0;
        for (const route of staleRoutes) {
            if (!await this.ports.markEmailRouteRoutingSuspected(route.emailJobId))
                continue;
            suspected += 1;
            this.logger.error(JSON.stringify({
                flow: "email_routing_watchdog",
                stage: "rule_match_timeout",
                emailJobId: route.emailJobId,
                campaignId: route.campaignId,
                eventId: route.eventId ?? "",
                publishedAt: route.publishedAt ?? "",
                cutoff
            }));
            try {
                const alert = await this.ports.publishAdminAlert({
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
                await this.ports.markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: true, messageId: alert.messageId });
                alertsSent += 1;
            }
            catch (error) {
                alertsFailed += 1;
                this.logger.error(JSON.stringify({
                    flow: "email_routing_watchdog",
                    stage: "admin_alert_failed",
                    emailJobId: route.emailJobId,
                    message: error instanceof Error ? error.message : "unknown"
                }));
                try {
                    await this.ports.markEmailRouteAlertResult({ emailJobId: route.emailJobId, sent: false });
                }
                catch (updateError) {
                    this.logger.error(JSON.stringify({
                        flow: "email_routing_watchdog",
                        stage: "alert_status_update_failed",
                        emailJobId: route.emailJobId,
                        message: updateError instanceof Error ? updateError.message : "unknown"
                    }));
                }
            }
        }
        const result = { evaluated: staleRoutes.length, suspected, alertsSent, alertsFailed };
        this.logger.log(JSON.stringify({ flow: "email_routing_watchdog", stage: "completed", ...result }));
        return result;
    }
}
