export type ProductMutationErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT";
export class ProductMutationError extends Error {
    constructor(readonly code: ProductMutationErrorCode, message: string) {
        super(message);
        this.name = "ProductMutationError";
    }
}
