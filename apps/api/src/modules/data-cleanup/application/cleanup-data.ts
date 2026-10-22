import { CleanupPolicy } from "../domain/cleanup-policy.js";
import type { CleanupPlan } from "../domain/cleanup-policy.js";
export type { CleanupPlan } from "../domain/cleanup-policy.js";
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
export class CleanupData<TCandidate> {
    constructor(private readonly store: CleanupStore<TCandidate>) { }
    async execute(now = new Date()) {
        if (!await this.store.tryStartDataCleanup(now)) {
            return { ran: false, reason: "not_due_or_already_running" as const };
        }
        const cleanupPlans = new CleanupPolicy(now.getTime()).plans();
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
