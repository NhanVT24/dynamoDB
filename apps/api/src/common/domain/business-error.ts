export type BusinessErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED";
/** A domain/application failure. HTTP mapping belongs to an outer adapter. */
export class BusinessError extends Error {
    constructor(readonly code: BusinessErrorCode, message: string) {
        super(message);
        // Preserve the public error identity used by existing logging/filter callers.
        this.name = "ApplicationError";
    }
}
