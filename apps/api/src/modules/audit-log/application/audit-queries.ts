export interface AuditIdentity {
    resourceType: string;
    resourceId: string;
    parentResourceId?: string;
    actor: {
        type: string;
        id: string;
    };
}
export interface AuditReadPort<TItem> {
    list(input: {
        resourceType?: unknown;
        limit?: unknown;
        cursor?: unknown;
    }): Promise<{
        items: TItem[];
        nextCursor: string | null;
    }>;
    get(input: {
        pk?: unknown;
        sk?: unknown;
    }): Promise<TItem>;
    orderEmails(ids: string[]): Promise<Map<string, string>>;
    userEmail(subject: string): Promise<string | undefined>;
}
export class AuditQueries<TItem extends AuditIdentity> {
    constructor(private readonly reads: AuditReadPort<TItem>) { }
    async list(input: {
        resourceType?: unknown;
        limit?: unknown;
        cursor?: unknown;
    }) {
        const page = await this.reads.list(input);
        return { ...page, items: await this.enrich(page.items) };
    }
    async detail(input: {
        pk?: unknown;
        sk?: unknown;
    }) {
        const item = await this.reads.get(input);
        return (await this.enrich([item]))[0];
    }
    private async enrich(items: TItem[]) {
        const subjects = new Set<string>();
        const orderIds = new Set<string>();
        for (const item of items) {
            if (item.resourceType === "USER")
                subjects.add(item.resourceId);
            if (item.actor.type === "USER" || item.actor.type === "ADMIN")
                subjects.add(item.actor.id);
            const orderId = item.resourceType === "ORDER" ? item.resourceId : item.parentResourceId;
            if (orderId)
                orderIds.add(orderId);
        }
        const [users, orders] = await Promise.all([
            Promise.all([...subjects].map(async (subject) => [subject, await this.reads.userEmail(subject)] as const)),
            this.reads.orderEmails([...orderIds])
        ]);
        const emails = new Map(users);
        return items.map((item) => ({
            ...item,
            ownerEmail: item.resourceType === "USER" ? emails.get(item.resourceId) : orders.get(item.resourceType === "ORDER" ? item.resourceId : item.parentResourceId ?? ""),
            actor: { ...item.actor, email: emails.get(item.actor.id) }
        }));
    }
}
