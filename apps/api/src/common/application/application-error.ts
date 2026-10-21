export type ApplicationErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED";
/** Transport-neutral failure; only the HTTP adapter chooses a status code. */
export class ApplicationError extends Error {
    constructor(readonly code: ApplicationErrorCode, message: string) {
        super(message);
        this.name = "ApplicationError";
    }
}
