import { EmailRecipient } from "../domain/email-recipient.js";
import type { FeedbackStatus } from "../domain/email-feedback.js";
export interface DeliveryFeedback {
    status: FeedbackStatus;
    statusAt: string;
    sesMessageId: string;
    recipientEmails?: string[];
    failureReason?: string;
}
export interface EmailFeedbackStore {
    markEmailAccepted(emailId: string, messageId: string): Promise<unknown>;
    listEmailRecipients(emailId: string): Promise<Array<{
        recipientId: string;
        recipientEmail: string;
    }>>;
    updateEmailRecipientStatus(input: DeliveryFeedback & {
        emailId: string;
        recipientId: string;
    }): Promise<unknown>;
    updateEmailDeliveryStatus(input: DeliveryFeedback & {
        id: string;
    }): Promise<unknown>;
    updateInventoryReportDeliveryStatus(input: {
        reportId: string;
        sesMessageId: string;
        status: FeedbackStatus;
        providerEventAt: string;
    }): Promise<unknown>;
}
export class RecordEmailFeedback {
    constructor(private readonly store: EmailFeedbackStore) { }
    async execute(input: DeliveryFeedback, identity: {
        emailId?: string;
        recipientId?: string;
        reportId?: string;
    }) {
        const { emailId, recipientId, reportId } = identity;
        const { markEmailAccepted, listEmailRecipients, updateEmailRecipientStatus, updateEmailDeliveryStatus, updateInventoryReportDeliveryStatus } = this.store;
        if (emailId) {
            // A pre-migration DETAIL item has no META. Its child update below remains
            // supported; current records persist the common SES message ID on META.
            await markEmailAccepted(emailId, input.sesMessageId);
            if (recipientId) {
                await updateEmailRecipientStatus({ ...input, emailId, recipientId });
            }
            else {
                // A shared To/CC/BCC message has one emailId tag. Only affected addresses
                // in the event may be updated; mail.destination includes ALL recipients.
                const recipients = await listEmailRecipients(emailId);
                if (recipients.length) {
                    if (!input.recipientEmails && recipients.length > 1)
                        throw new Error("Cannot attribute SES event to recipients.");
                    for (const recipient of recipients) {
                        if (new EmailRecipient(recipient.recipientEmail).isAffected(input.recipientEmails)) {
                            await updateEmailRecipientStatus({ ...input, emailId, recipientId: recipient.recipientId });
                        }
                    }
                }
                else {
                    await updateEmailDeliveryStatus({ ...input, id: emailId });
                }
            }
        }
        // Preserve the existing report projection. Both writes are independently
        // idempotent so a retry after partial completion is safe.
        if (reportId)
            await updateInventoryReportDeliveryStatus({
                reportId,
                sesMessageId: input.sesMessageId,
                status: input.status,
                providerEventAt: input.statusAt
            });
        return { emailId, recipientId, status: input.status };
    }
}
