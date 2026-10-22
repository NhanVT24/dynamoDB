export interface EmailRouteSnapshot {
    emailJobId: string;
    publishAttempts: number;
    eventSource?: string;
    eventDetailType?: string;
    eventDetail?: Record<string, unknown>;
}
export class EmailRoute {
    readonly #state: Readonly<EmailRouteSnapshot>;
    constructor(snapshot: EmailRouteSnapshot) { this.#state = Object.freeze({ ...snapshot }); }
    exhausted(maxAttempts: number) { return this.#state.publishAttempts >= maxAttempts; }
    get hasPublishPayload() { return Boolean(this.#state.eventSource && this.#state.eventDetailType && this.#state.eventDetail); }
}
