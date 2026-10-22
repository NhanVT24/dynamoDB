export interface CleanupPlan {
    entityType: "NOTIFICATION" | "CHECKOUT_GATE" | "CHECKOUT_RESERVATION" | "INVENTORY_DAILY_REPORT" | "EMAIL" | "EMAIL_ROUTE";
    updatedBefore: string;
    isEligible(item: {
        status?: string;
        isRead?: boolean;
    }): boolean;
}
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export class CleanupPolicy {
    constructor(private readonly referenceTime: number) { }
    plans() {
        const now = new Date(this.referenceTime);
        const shortLivedCutoff = new Date(now.getTime() - THREE_DAYS_MS).toISOString();
        const reportCutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
        return [
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
    }
}
