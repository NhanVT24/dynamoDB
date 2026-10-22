import { Payment } from "../domain/payment-session.js";
import type { PaymentSessions } from "./ports/payment-ports.js";
/** Called only after the provider adapter has verified signature and fields.
 * Browser polling has no permission to finalize payments or trigger side effects.
 */
export class ReadPaymentReturn {
    constructor(private readonly sessions: Pick<PaymentSessions, "find">) { }
    async execute(txnRef: string, amountMinor: string) {
        const session = await this.sessions.find(txnRef);
        if (!session || !new Payment(session).matchesAmount(amountMinor)) {
            return null;
        }
        return session;
    }
}
