export interface NotificationSnapshot {
    id: string;
    customerEmail: string;
    isRead: boolean;
    metadata?: Record<string, unknown>;
}
export class Notification<T extends NotificationSnapshot = NotificationSnapshot> {
    readonly #state: Readonly<T>;
    constructor(snapshot: T) {
        this.#state = Object.freeze({ ...snapshot, metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined });
    }
    get isUnread() { return !this.#state.isRead; }
    isVisibleToAdmin(email: string, configuredEmail?: string) {
        const adminEmails = new Set([email, String(configuredEmail ?? "").trim().toLowerCase()].filter(Boolean));
        const audience = String(this.#state.metadata?.audience ?? "").trim().toLowerCase();
        return audience === "admin" || adminEmails.has(String(this.#state.customerEmail ?? "").trim().toLowerCase());
    }
    static assertSystemChannel(channel: "system" | "email") {
        if (channel === "email")
            throw new Error("Email delivery must be queued through the email route, not createPendingNotification.");
    }
}
