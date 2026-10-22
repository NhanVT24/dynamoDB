export class OrderActionError extends Error {
    constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT", message: string) {
        super(message);
        this.name = "OrderActionError";
    }
}
