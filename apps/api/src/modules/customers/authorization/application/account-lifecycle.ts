import { canSignIn } from "../domain/account-status.js";
export interface AccountAuthorizationReader {
    status(subject: string): Promise<string>;
    permissions(subject: string): Promise<string[]>;
}
export class AccountAccess {
    constructor(private readonly accounts: AccountAuthorizationReader) { }
    async signIn(subject: string) {
        const status = await this.accounts.status(subject);
        if (!canSignIn(status))
            throw new Error("This account is not allowed to sign in. Please contact support.");
        return status;
    }
    async claims(input: {
        subject: string;
        groups: string[];
        email: string;
        displayName: string;
        provider: string;
    }) {
        const status = input.subject ? await this.accounts.status(input.subject) : "ACTIVE";
        if (!canSignIn(status))
            throw new Error("This account is not allowed to receive new tokens. Please contact support.");
        const permissions = input.subject ? await this.accounts.permissions(input.subject) : [];
        return { identity: { role: input.groups.includes("admin") ? "admin" : "customer", auth_provider: input.provider,
                principal_email: input.email, display_name: input.displayName, account_status: status }, permissions,
            groups: input.groups.length ? input.groups : ["customer"] };
    }
}
export interface ConfirmedProfile {
    subject: string;
    email: string;
    displayName: string;
}
export interface AccountConfirmationPorts {
    reset(subject: string): Promise<void>;
    assignCustomer(): Promise<void>;
    persistProfile(): Promise<ConfirmedProfile>;
    welcome(profile: ConfirmedProfile): Promise<void>;
}
export class ConfirmAccount {
    constructor(private readonly ports: AccountConfirmationPorts) { }
    async execute(kind: "password_reset" | "sign_up" | "other", subject?: string) {
        if (kind === "password_reset") {
            if (!subject)
                throw new Error("Cannot audit password reset without a user subject.");
            await this.ports.reset(subject);
        }
        else if (kind === "sign_up") {
            await this.ports.assignCustomer();
            const profile = await this.ports.persistProfile();
            await this.ports.welcome(profile);
        }
    }
}
