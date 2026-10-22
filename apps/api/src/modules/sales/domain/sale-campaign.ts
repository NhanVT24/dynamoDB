import { BusinessError } from "../../../common/domain/business-error.js";
import type { NewSaleCampaign, SaleCampaign } from "./campaign.js";
export class Campaign {
    readonly #state: Readonly<SaleCampaign>;
    constructor(snapshot: SaleCampaign) {
        this.#state = Object.freeze({ ...snapshot, productIds: [...snapshot.productIds] });
    }
    toSnapshot(): SaleCampaign { return { ...this.#state, productIds: [...this.#state.productIds] }; }
    static assertCreation(input: NewSaleCampaign, now: number): void {
        const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start <= now + 60000 || end <= start) {
            throw new BusinessError("INVALID_INPUT", "Sale must start at least one minute from now and end after it starts.");
        }
    }
    removeProduct(productId: string) {
        const status = this.#state.campaignStatus;
        if (status !== "scheduled" && status !== "active") {
            throw new BusinessError("INVALID_INPUT", "Only scheduled or active sale campaigns can be changed.");
        }
        const productIds = this.#state.productIds.filter(id => id !== productId);
        return { expectedStatus: status, productIds, alreadyAbsent: !this.#state.productIds.includes(productId), closed: productIds.length === 0 };
    }
    scheduledTransition(action: string | undefined, now: number) {
        if (action === "start")
            return { from: "scheduled" as const, to: now >= Date.parse(this.#state.endAt) ? "ended" as const : "active" as const };
        if (action === "end")
            return { from: this.#state.campaignStatus === "scheduled" ? "scheduled" as const : "active" as const, to: "ended" as const };
        return null;
    }
}
