export class EmailCampaign {
    readonly #recipients: readonly string[];
    constructor(readonly id: string, readonly subject: string, readonly body: string, recipients: readonly string[]) {
        this.#recipients = Object.freeze([...recipients]);
    }
    batches(): string[][] {
        return Array.from({ length: Math.ceil(this.#recipients.length / 50) }, (_, index) => this.#recipients.slice(index * 50, (index + 1) * 50));
    }
    get html() {
        return this.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r?\n/g, "<br />");
    }
}
