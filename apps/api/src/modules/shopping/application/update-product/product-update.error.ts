export type ProductUpdateErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT";

export class ProductUpdateError extends Error {
  constructor(readonly code: ProductUpdateErrorCode, message: string) {
    super(message);
    this.name = "ProductUpdateError";
  }
}
