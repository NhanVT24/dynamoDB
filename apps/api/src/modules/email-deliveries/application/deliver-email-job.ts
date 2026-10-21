import type { ApplicationLogger } from "../../../common/application/queue-events.js";
import type { EmailJob, ConfirmationMail } from "../domain/email-jobs.js";
export interface EmailDeliveryPorts {
    markEmailRouteProcessing(id: string): Promise<boolean>;
    sendWelcomeEmail(input: {
        emailJobId: string;
        userSub: string;
        toEmail: string;
        displayName?: string;
    }): Promise<{
        status: string;
        emailId: string;
    }>;
    sendOrderConfirmationEmail(input: ConfirmationMail): Promise<{
        emailId: string;
    }>;
    sendBulkSaleEmailBatch(input: {
        emailId: string;
        senderEmail: string;
        recipients: string[];
        subject: string;
        html: string;
        text: string;
        relatedId: string;
    }): Promise<{
        status: string;
        failureReason?: string;
    }>;
}
export class DeliverEmailJob {
    constructor(private readonly ports: EmailDeliveryPorts, private readonly logger: ApplicationLogger) { }
    async execute(job: EmailJob, options: {
        messageId?: string;
        receiveCount: number;
        testMode?: string;
        testOnly?: {
            skipSesOnSuccess?: boolean;
        };
    }): Promise<"completed" | "unknown"> {
        if (job.type === "email.account_welcome.requested") {
            this.logger.log(JSON.stringify({
                flow: "account_welcome_email",
                stage: "email_worker_started",
                emailJobId: job.emailJobId,
                userSub: job.userSub,
                sqsMessageId: options.messageId ?? ""
            }));
            const result = await this.ports.sendWelcomeEmail({
                emailJobId: job.emailJobId,
                userSub: job.userSub,
                toEmail: job.toEmail,
                displayName: job.displayName
            });
            this.logger.log(JSON.stringify({
                flow: "account_welcome_email",
                stage: result.status === "already_processed"
                    ? "email_worker_deduplicated"
                    : result.status === "accepted"
                        ? "ses_accepted"
                        : result.status === "partial_sent"
                            ? "ses_partially_accepted"
                            : "ses_rejected",
                emailJobId: result.emailId,
                status: result.status
            }));
            return "completed";
        }
        if (job.type === "email.order_confirmation.requested") {
            const routeAdvanced = await this.ports.markEmailRouteProcessing(job.emailJobId);
            const result = await this.ports.sendOrderConfirmationEmail({
                toEmail: job.toEmail,
                orderId: job.orderId,
                totalAmount: job.totalAmount,
                createdAt: job.createdAt,
                paymentConfirmedAt: job.paymentConfirmedAt,
                items: job.items
            });
            this.logger.log(JSON.stringify({
                flow: "order_confirmation_email",
                stage: "ses_accepted",
                emailJobId: job.emailJobId,
                orderId: job.orderId,
                emailId: result.emailId,
                routeTracked: routeAdvanced
            }));
            return "completed";
        }
        const routeAdvanced = await this.ports.markEmailRouteProcessing(job.emailJobId);
        this.logger.log(JSON.stringify({
            flow: "email_campaign",
            stage: "email_worker_started",
            campaignId: job.campaignId,
            emailJobId: job.emailJobId,
            batchIndex: job.batchIndex,
            batchCount: job.batchCount,
            recipientCount: job.recipients.length,
            sqsMessageId: options.messageId ?? "",
            routeTracked: routeAdvanced
        }));
        // This opt-in hook is disabled by default. Test mode "fail" drives a
        // message to the DLQ; after an operator fixes the cause, mode "recover"
        // lets the same redriven message succeed without calling SES.
        if (options.testOnly && options.testMode === "fail") {
            throw new Error(`Injected failure for DLQ test at receive ${options.receiveCount}.`);
        }
        if (options.testOnly?.skipSesOnSuccess && options.testMode === "recover") {
            this.logger.log(JSON.stringify({
                flow: "email_campaign",
                stage: "email_worker_test_recovered",
                campaignId: job.campaignId,
                emailJobId: job.emailJobId,
                receiveCount: options.receiveCount,
                sqsMessageId: options.messageId ?? ""
            }));
            return "completed";
        }
        const result = await this.ports.sendBulkSaleEmailBatch({
            emailId: job.emailJobId,
            senderEmail: job.senderEmail,
            recipients: job.recipients,
            subject: job.subject,
            html: job.html,
            text: job.text,
            relatedId: job.campaignId
        });
        this.logger.log(JSON.stringify({
            flow: "email_campaign",
            // SES API acceptance and mailbox delivery are distinct states. Never
            // label an API rejection/ambiguous result as a successful send.
            stage: result.status === "already_processed"
                ? "email_worker_deduplicated"
                : result.status === "accepted"
                    ? "ses_accepted"
                    : result.status === "partial_sent"
                        ? "ses_partially_accepted"
                        : result.status === "failed"
                            ? "ses_rejected"
                            : "ses_outcome_unknown",
            campaignId: job.campaignId,
            emailJobId: job.emailJobId,
            batchIndex: job.batchIndex,
            recipientCount: job.recipients.length,
            status: result.status,
            failureReason: result.failureReason ?? ""
        }));
        return result.status === "unknown" ? "unknown" : "completed";
    }
}
