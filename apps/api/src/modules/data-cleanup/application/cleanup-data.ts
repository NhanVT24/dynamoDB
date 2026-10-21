export interface CleanupPlan {
    entityType: "NOTIFICATION" | "CHECKOUT_GATE" | "CHECKOUT_RESERVATION" | "INVENTORY_DAILY_REPORT" | "EMAIL" | "EMAIL_ROUTE";
    updatedBefore: string;
    isEligible(item: {
        status?: string;
        isRead?: boolean;
    }): boolean;
}
export interface CleanupStore<TCandidate> {
    tryStartDataCleanup(now: Date): Promise<boolean>;
    listCleanupCandidates(plan: CleanupPlan): Promise<{
        candidates: TCandidate[];
        hasRemainingBacklog: boolean;
    }>;
    deleteCleanupCandidates(candidates: TCandidate[]): Promise<number>;
    markDataCleanupCompleted(input: {
        hasRemainingBacklog: boolean;
        now: Date;
    }): Promise<void>;
}
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export class CleanupData<TCandidate> {
    constructor(private readonly store: CleanupStore<TCandidate>) { }
    async execute(now = new Date()) {
        if (!await this.store.tryStartDataCleanup(now)) {
            return { ran: false, reason: "not_due_or_already_running" as const };
        }
        const shortLivedCutoff = new Date(now.getTime() - THREE_DAYS_MS).toISOString();
        const reportCutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
        const cleanupPlans = [
            {
                name: "readNotifications",
                entityType: "NOTIFICATION" as const,
                updatedBefore: shortLivedCutoff,
                isEligible: (item: {
                    status?: string;
                    isRead?: boolean;
                }) => item.isRead === true || item.status === "read"
            },
            {
                name: "terminalCheckoutGates",
                entityType: "CHECKOUT_GATE" as const,
                updatedBefore: shortLivedCutoff,
                isEligible: (item: {
                    status?: string;
                }) => item.status === "blocked" || item.status === "completed"
            },
            {
                name: "terminalCheckoutReservations",
                entityType: "CHECKOUT_RESERVATION" as const,
                updatedBefore: shortLivedCutoff,
                isEligible: (item: {
                    status?: string;
                }) => item.status === "released" || item.status === "committed"
            },
            {
                name: "inventoryReportAudit",
                entityType: "INVENTORY_DAILY_REPORT" as const,
                updatedBefore: reportCutoff,
                isEligible: () => true
            },
            {
                name: "emailDeliveryAudit",
                entityType: "EMAIL" as const,
                updatedBefore: reportCutoff,
                isEligible: () => true
            },
            {
                name: "emailRoutingAudit",
                entityType: "EMAIL_ROUTE" as const,
                updatedBefore: reportCutoff,
                isEligible: () => true
            }
        ];
        const counts: Record<string, number> = {};
        let hasRemainingBacklog = false;
        for (const plan of cleanupPlans) {
            const result = await this.store.listCleanupCandidates(plan);
            counts[plan.name] = await this.store.deleteCleanupCandidates(result.candidates);
            hasRemainingBacklog ||= result.hasRemainingBacklog;
        }
        await this.store.markDataCleanupCompleted({ hasRemainingBacklog, now });
        return { ran: true, counts, hasRemainingBacklog };
    }
}
