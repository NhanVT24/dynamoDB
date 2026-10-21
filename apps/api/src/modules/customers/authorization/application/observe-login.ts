export interface LoginObservation {
    subject: string;
    email: string;
    ipAddress: string;
    at: string;
    auditId: string;
}
export class ObserveSuccessfulLogin {
    constructor(private readonly store: {
        record(input: LoginObservation): Promise<void>;
    }, private readonly warn: (subject: string, error: unknown) => void, private readonly newId: () => string, private readonly now: () => number = Date.now) { }
    async execute(input: Pick<LoginObservation, "subject" | "email" | "ipAddress">) {
        if (!input.subject)
            return;
        try {
            await this.store.record({ ...input, at: new Date(this.now()).toISOString(), auditId: this.newId() });
        }
        catch (error) {
            this.warn(input.subject, error);
        }
    }
}
