export interface PaymentReviewAdministrationPort<TPage> {
    list(limit: number, cursor?: string): Promise<TPage>;
    resolve(txnRef: string, actor: string, note: string, externalReference: string): Promise<void>;
}
export class PaymentReviewAdministration<TPage> {
    constructor(private readonly reviews: PaymentReviewAdministrationPort<TPage>) { }
    list(limit: number, cursor?: string) { return this.reviews.list(limit, cursor); }
    async resolve(txnRef: string, actor: string, note: string, externalReference: string) {
        await this.reviews.resolve(txnRef, actor, note, externalReference);
        return { success: true, txnRef, status: "payment_review_resolved" };
    }
}
