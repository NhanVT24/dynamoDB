export interface CustomerCandidate {
    email: string;
    displayName: string;
    enabled: boolean;
    emailVerified: boolean;
}
export interface CustomerDirectoryPort {
    search(search: string, limit: number): Promise<CustomerCandidate[]>;
}
export class ListVerifiedCustomers {
    constructor(private readonly directory: CustomerDirectoryPort) { }
    async execute(search = "", limit = 25) {
        const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 25;
        const candidates = await this.directory.search(search.trim(), safeLimit), seen = new Set<string>();
        const result: Array<{
            email: string;
            displayName: string;
            emailVerified: true;
        }> = [];
        for (const candidate of candidates) {
            const email = candidate.email.trim().toLowerCase();
            if (!candidate.enabled || !candidate.emailVerified || !email || seen.has(email))
                continue;
            seen.add(email);
            result.push({ email, displayName: candidate.displayName || email, emailVerified: true });
            if (result.length === safeLimit)
                break;
        }
        return result;
    }
}
