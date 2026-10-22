import { BusinessError } from "../../../common/domain/business-error.js";
export interface EmailDeliverySnapshot {
    id: string;
    html?: string;
    text?: string;
}
export interface EmailRecipientSnapshot {
    recipientEmail: string;
    status: string;
}
export class EmailDelivery<T extends EmailDeliverySnapshot = EmailDeliverySnapshot> {
    readonly #meta: Readonly<T>;
    readonly #recipients: readonly Readonly<EmailRecipientSnapshot>[];
    constructor(meta: T, recipients: readonly EmailRecipientSnapshot[] = []) {
        this.#meta = Object.freeze({ ...meta });
        this.#recipients = Object.freeze(recipients.map(recipient => Object.freeze({ ...recipient })));
    }
    publicSnapshot(): Omit<T, "html" | "text"> {
        const { html: _html, text: _text, ...safe } = this.#meta;
        return safe;
    }
    retryRecipients(): string[] {
        if (!this.#meta.html || !this.#meta.text) {
            throw new BusinessError("INVALID_INPUT", "This legacy delivery does not retain its content and cannot be retried safely.");
        }
        const recipients = this.#recipients.filter(recipient => EmailDelivery.isSafelyRetryable(recipient.status)).map(recipient => recipient.recipientEmail);
        if (!recipients.length)
            throw new BusinessError("INVALID_INPUT", "No recipient has a safely retryable delivery status.");
        return recipients;
    }
    static isSafelyRetryable(status: string) { return ["failed", "not_sent", "rejected"].includes(status); }
}
